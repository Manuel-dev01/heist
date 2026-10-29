[CmdletBinding()]
param(
  [string]$PgBin = 'C:/Program Files/PostgreSQL/16/bin',
  [ValidateRange(1024, 65535)][int]$Port = 55400
)
$ErrorActionPreference = 'Stop'
$heistRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$heistEvidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $heistRepoRoot '.heist'))
$heistRunName = 'sql-validation-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$heistRunDir = [System.IO.Path]::GetFullPath((Join-Path $heistEvidenceRoot $heistRunName))
if (-not $heistRunDir.StartsWith($heistEvidenceRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Disposable data directory escaped the intended workspace.'
}
foreach ($heistTool in @('initdb.exe', 'pg_ctl.exe', 'createdb.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PgBin $heistTool) -PathType Leaf)) { throw "Missing PostgreSQL binary: $heistTool" }
}
$heistPortProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $heistPortProbe.Start() } finally { $heistPortProbe.Stop() }
New-Item -ItemType Directory -Path $heistRunDir -ErrorAction Stop | Out-Null
$heistDataDir = Join-Path $heistRunDir 'data'
$heistPassFile = Join-Path $heistRunDir 'empty.pgpass'
[System.IO.File]::WriteAllText($heistPassFile, '')
$heistInitialized = $false
$heistNativeResources = [System.Collections.Generic.List[object]]::new()
$heistSummary = [ordered]@{
  status = 'running'; dataDirectory = $heistDataDir; host = '127.0.0.1'; hostaddr = '127.0.0.1'; port = $Port;
  schemaSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '001_attempts.sql') -Algorithm SHA256).Hash.ToLowerInvariant();
  checks = $null; connectionPreflight = $null; sanitizedNativeChildren = 0;
  recordsAfterRollback = $null; ownedServerStopped = $false;
  existingServicesTouched = $false; providerRequests = 0
}
function New-HeistConnectionString {
  param([ValidatePattern('^[a-z_]+$')][string]$Database, [ValidatePattern('^[a-z_]+$')][string]$Role)
  $heistQuotedPassFile = $heistPassFile.Replace('\', '/').Replace("'", "\'")
  return "host=127.0.0.1 hostaddr=127.0.0.1 port=$Port dbname=$Database user=$Role connect_timeout=5 sslmode=disable gssencmode=disable passfile='$heistQuotedPassFile' application_name=heist_disposable_validation"
}
function Invoke-HeistPgTool {
  param([string]$Tool, [string[]]$Arguments, [string]$Log,
    [switch]$AllowNonzero, [switch]$PassExitCode, [switch]$SyntheticPoison)
  $heistStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $heistStartInfo.FileName = Join-Path $PgBin $Tool
  $heistStartInfo.UseShellExecute = $false
  $heistStartInfo.CreateNoWindow = $true
  $heistStartInfo.RedirectStandardOutput = $true
  $heistStartInfo.RedirectStandardError = $true
  foreach ($heistArgument in $Arguments) { $heistStartInfo.ArgumentList.Add($heistArgument) }
  if ($SyntheticPoison) {
    # Fixed synthetic values in this child's environment clone only. No real
    # inherited values are inspected, logged or restored into another process.
    $heistStartInfo.Environment['PGHOSTADDR'] = '127.0.0.2'
    $heistStartInfo.Environment['PGSERVICE'] = 'heist_nonexistent_poison_service'
    $heistStartInfo.Environment['PGSERVICEFILE'] = Join-Path $heistRunDir 'nonexistent-poison-service.conf'
  }
  # libpq has independent host/hostaddr and service-file defaults. Strip all PG*
  # names from every native child; never enumerate or print their actual values.
  foreach ($heistEnvironmentName in @($heistStartInfo.Environment.Keys)) {
    if ($heistEnvironmentName.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase)) {
      [void]$heistStartInfo.Environment.Remove($heistEnvironmentName)
    }
  }
  if (@($heistStartInfo.Environment.Keys | Where-Object { $_.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) {
    throw 'PostgreSQL child environment isolation failed before dispatch.'
  }
  $heistSummary.sanitizedNativeChildren += 1
  $heistProcess = [System.Diagnostics.Process]::new()
  $heistProcess.StartInfo = $heistStartInfo
  $heistResource = [pscustomobject]@{
    Process = $heistProcess; OutTask = $null; ErrorTask = $null;
    OutFile = [System.IO.File]::Open($Log, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite);
    ErrorFile = [System.IO.File]::Open($Log + '.stderr', [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
  }
  $heistNativeResources.Add($heistResource)
  if (-not $heistProcess.Start()) { throw "$Tool did not start." }
  $heistResource.OutTask = $heistProcess.StandardOutput.BaseStream.CopyToAsync($heistResource.OutFile)
  $heistResource.ErrorTask = $heistProcess.StandardError.BaseStream.CopyToAsync($heistResource.ErrorFile)
  if (-not $heistProcess.WaitForExit(30000)) {
    $heistProcess.Kill()
    throw "$Tool exceeded the local validation deadline; see $Log"
  }
  $heistProcess.Refresh()
  $heistExitCode = $heistProcess.ExitCode
  # pg_ctl's background server may inherit its output pipe. Wait only for pg_ctl
  # here, and drain/dispose all remaining streams after owned-cluster shutdown.
  if (-not ($Tool -eq 'pg_ctl.exe' -and $Arguments[-1] -eq 'start')) {
    if (-not $heistResource.OutTask.Wait(5000) -or -not $heistResource.ErrorTask.Wait(5000)) {
      throw "$Tool output did not complete within its local deadline."
    }
    $heistResource.OutFile.Flush()
    $heistResource.ErrorFile.Flush()
  }
  if (-not $AllowNonzero -and $heistExitCode -ne 0) { throw "$Tool failed; see $Log and $Log.stderr" }
  if ($PassExitCode) { return $heistExitCode }
}
try {
  Invoke-HeistPgTool -Tool 'initdb.exe' -Arguments @('-D', $heistDataDir, '-U', 'heist_validation_owner', '--auth-host=trust', '--auth-local=trust', '--locale=C', '--encoding=UTF8') -Log (Join-Path $heistRunDir 'initdb.log')
  $heistInitialized = $true
  Invoke-HeistPgTool -Tool 'pg_ctl.exe' -Arguments @('-D', $heistDataDir, '-l', (Join-Path $heistRunDir 'server.log'), '-o', "-h 127.0.0.1 -p $Port -c statement_timeout=10000", '-w', '-t', '20', 'start') -Log (Join-Path $heistRunDir 'startup.txt')
  $heistMaintenanceConnection = New-HeistConnectionString -Database 'postgres' -Role 'heist_validation_owner'
  Invoke-HeistPgTool -Tool 'createdb.exe' -Arguments @('--maintenance-db', $heistMaintenanceConnection, '-w', 'heist_validation') -Log (Join-Path $heistRunDir 'database-create.txt')
  $heistOwnerConnection = New-HeistConnectionString -Database 'heist_validation' -Role 'heist_validation_owner'
  $heistPsqlOwnerArgs = @('-X', '-w', '-d', $heistOwnerConnection, '-v', 'ON_ERROR_STOP=1')
  Invoke-HeistPgTool -Tool 'psql.exe' -Arguments ($heistPsqlOwnerArgs + @('-f', (Join-Path $PSScriptRoot '001_attempts.sql'))) -Log (Join-Path $heistRunDir 'schema-apply.txt')
  # Expanded mutation privileges are confined to this disposable test database.
  Invoke-HeistPgTool -Tool 'psql.exe' -Arguments ($heistPsqlOwnerArgs + @('-c', 'CREATE ROLE heist_validation_app LOGIN; GRANT USAGE ON SCHEMA heist TO heist_validation_app; GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON heist.attempts TO heist_validation_app;')) -Log (Join-Path $heistRunDir 'test-role-setup.txt')
  $heistAppConnection = New-HeistConnectionString -Database 'heist_validation' -Role 'heist_validation_app'
  $heistPsqlAppArgs = @('-X', '-w', '-d', $heistAppConnection, '-v', 'ON_ERROR_STOP=1')
  $heistPreflightLog = Join-Path $heistRunDir 'environment-preflight.txt'
  $heistPreflightQuery = "SELECT json_build_object('server_address',host(inet_server_addr()),'server_port',inet_server_port(),'database',current_database(),'role',current_user,'loopback_only',current_setting('listen_addresses')='127.0.0.1');"
  Invoke-HeistPgTool -Tool 'psql.exe' -Arguments ($heistPsqlAppArgs + @('-A', '-t', '-c', $heistPreflightQuery)) -Log $heistPreflightLog -SyntheticPoison
  $heistSummary.connectionPreflight = (Get-Content -LiteralPath $heistPreflightLog -Raw) | ConvertFrom-Json
  if ($heistSummary.connectionPreflight.server_address -ne '127.0.0.1' -or
      $heistSummary.connectionPreflight.server_port -ne $Port -or
      $heistSummary.connectionPreflight.database -ne 'heist_validation' -or
      $heistSummary.connectionPreflight.role -ne 'heist_validation_app' -or
      -not $heistSummary.connectionPreflight.loopback_only) { throw 'Disposable connection identity preflight failed.' }
  $heistSummary.connectionPreflight | Add-Member -NotePropertyName syntheticPgPoisonRemoved -NotePropertyValue $true
  $heistValidationLog = Join-Path $heistRunDir 'validation.txt'
  Invoke-HeistPgTool -Tool 'psql.exe' -Arguments ($heistPsqlAppArgs + @('-f', (Join-Path $PSScriptRoot 'validation.sql'))) -Log $heistValidationLog
  $heistSummaryLine = Get-Content -LiteralPath $heistValidationLog | Where-Object { $_ -match '^\{"postgresql_version"' } | Select-Object -Last 1
  if (-not $heistSummaryLine) { throw 'Validation summary missing.' }
  $heistSummary.checks = $heistSummaryLine | ConvertFrom-Json
  if (-not $heistSummary.checks.all_expected_states_matched) { throw 'SQL checks did not all pass.' }
  $heistRollbackLog = Join-Path $heistRunDir 'rollback-count.txt'
  Invoke-HeistPgTool -Tool 'psql.exe' -Arguments ($heistPsqlAppArgs + @('-A', '-t', '-c', 'SELECT count(*) FROM heist.attempts;')) -Log $heistRollbackLog
  $heistSummary.recordsAfterRollback = [int]((Get-Content -LiteralPath $heistRollbackLog -Raw).Trim())
  if ($heistSummary.recordsAfterRollback -ne 0) { throw 'Validation transaction did not roll back all rows.' }
  $heistSummary.status = 'passed'
} catch {
  $heistSummary.status = 'failed'
  throw
} finally {
  $heistTeardownFailure = $null
  try {
    if ($heistInitialized) {
      $heistPreShutdownCode = Invoke-HeistPgTool -Tool 'pg_ctl.exe' -Arguments @('-D', $heistDataDir, 'status') -Log (Join-Path $heistRunDir 'pre-shutdown-status.txt') -AllowNonzero -PassExitCode
      if ($heistPreShutdownCode -eq 0) {
        Invoke-HeistPgTool -Tool 'pg_ctl.exe' -Arguments @('-D', $heistDataDir, '-m', 'fast', '-w', '-t', '20', 'stop') -Log (Join-Path $heistRunDir 'shutdown.txt')
      }
      $heistPostShutdownCode = Invoke-HeistPgTool -Tool 'pg_ctl.exe' -Arguments @('-D', $heistDataDir, 'status') -Log (Join-Path $heistRunDir 'post-shutdown-status.txt') -AllowNonzero -PassExitCode
      $heistSummary.ownedServerStopped = ($heistPostShutdownCode -ne 0)
      if (-not $heistSummary.ownedServerStopped) { throw 'Owned disposable server did not stop.' }
    }
  } catch {
    $heistSummary.status = 'failed'
    $heistTeardownFailure = $_
  } finally {
    foreach ($heistResource in $heistNativeResources) {
      try {
        if ($heistResource.OutTask -and -not $heistResource.OutTask.Wait(5000)) { throw 'Native stdout remained open after teardown.' }
        if ($heistResource.ErrorTask -and -not $heistResource.ErrorTask.Wait(5000)) { throw 'Native stderr remained open after teardown.' }
      } catch { $heistSummary.status = 'failed'; $heistTeardownFailure = $_ }
      finally { $heistResource.OutFile.Dispose(); $heistResource.ErrorFile.Dispose(); $heistResource.Process.Dispose() }
    }
    $heistSummary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $heistRunDir 'summary.json') -Encoding utf8
    Write-Output (Join-Path $heistRunDir 'summary.json')
  }
  if ($heistTeardownFailure) { throw $heistTeardownFailure }
}
