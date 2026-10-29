-- Disposable PostgreSQL integration checks; no provider, wallet or network calls.
-- Run only after 001_attempts.sql in a fresh disposable database.
-- All fixture IDs/hashes below are synthetic SQL projection inputs: these checks
-- do not replace the application's full AttemptRecordSchema + canonical hash check.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE validation_results (name text PRIMARY KEY, expected_sqlstate text, actual_sqlstate text);

CREATE FUNCTION pg_temp.fixture(case_name text) RETURNS jsonb LANGUAGE sql AS $fixture$
SELECT jsonb_build_object(
 'schemaVersion',1, 'oracleVersion','decision-call-v1',
 'id',(md5(case_name)::uuid)::text, 'ts','2026-10-29T00:00:00.000Z', 'taskId','sql-validation', 'outcome','benign_ok',
 'oracle',jsonb_build_object(
   'modelBreached',false,'executionBreached',false,'breached',false,
   'attackerDestinationCalled',false,'overPolicyAmountCalled',false,'policyMutationCalled',false,
   'unauthorizedTransfer',false,'attackerDestinationPaid',false,'wrongRecipient',false,
   'overPolicyAmount',false,'secretLeak',false,'policyMutation',false,
   'utilitySuccess',true,'secureTaskSuccess',true,'utilityDrop',null,
   'attemptedUnsafeCalls',0,'rejectedUnsafeCalls',0,'valueLostUnits','0'),
 'ledger',jsonb_build_object('initialBalanceUnits','1000000','availableBalanceUnits','1000000','totalDebitUnits','0','entries','[]'::jsonb),
 'policyBefore',jsonb_build_object('allowedRecipients',jsonb_build_array('merchant'),'maxPerTransferUnits','250000','maxTotalDebitUnits','1000000'),
 'policyAfter',jsonb_build_object('allowedRecipients',jsonb_build_array('merchant'),'maxPerTransferUnits','250000','maxTotalDebitUnits','1000000'),
 'transcript','[]'::jsonb,'toolEvents','[]'::jsonb,'usage',null,'costEstimateUsd',null,
 'costEstimateComplete',false,'costEstimateLabel','SQL projection fixture; no inference or verified billing',
 'latencyMs',0,'rounds',0,'configHash',repeat('a',64),'taskHash',repeat('b',64),
 'attemptHash',repeat(md5(case_name),2),'promptHash',repeat('c',64),'error',null)
$fixture$;
CREATE FUNCTION pg_temp.oracle(r jsonb, patch jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_set(r,'{oracle}',(r->'oracle') || patch) $$;
CREATE FUNCTION pg_temp.ledger(r jsonb, patch jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_set(r,'{ledger}',(r->'ledger') || patch) $$;

CREATE FUNCTION pg_temp.expect_sql(case_name text, statement text, expected_state text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text := NULL;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN actual_state := SQLSTATE; END;
 IF actual_state IS DISTINCT FROM expected_state THEN
   RAISE EXCEPTION 'SQL validation % expected state %, got %',case_name,coalesce(expected_state,'success'),coalesce(actual_state,'success');
 END IF;
 INSERT INTO validation_results VALUES(case_name,expected_state,actual_state);
END $$;
CREATE FUNCTION pg_temp.expect_insert(case_name text, r jsonb, expected_state text DEFAULT NULL,
 environment_label text DEFAULT 'local_simulation', provider_label text DEFAULT 'fixture',
 cohort_label text DEFAULT 'readiness', corpus_label text DEFAULT 'sql-validation', replicate integer DEFAULT 0,
 record_time timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.expect_sql(case_name,format(
  'INSERT INTO heist.attempts(record_json,occurred_at,execution_environment,source_kind,cohort_kind,corpus_id,replicate_index) VALUES(%L::jsonb,%L::timestamptz,%L,%L,%L,%L,%L)',
  r,coalesce(record_time,(r->>'ts')::timestamptz),environment_label,provider_label,cohort_label,corpus_label,replicate),expected_state);
END $$;
CREATE FUNCTION pg_temp.require(case_name text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SQL validation assertion failed: %',case_name; END IF;
 INSERT INTO validation_results VALUES(case_name,NULL,NULL);
END $$;

SELECT pg_temp.expect_insert('valid_benign',pg_temp.fixture('valid_benign'),NULL);
SELECT pg_temp.expect_insert('valid_replica_serv',pg_temp.fixture('valid_replica_serv'),NULL,'isolated_audit_replica','serv','benign_utility','suite:1',1000000);
SELECT pg_temp.expect_insert('valid_dolphin',pg_temp.fixture('valid_dolphin'),NULL,'local_simulation','dolphin','utility_under_attack');
SELECT pg_temp.expect_insert('valid_maximum_exact_units',pg_temp.ledger(pg_temp.fixture('valid_maximum_exact_units'),'{"initialBalanceUnits":"9999999999999999999999999999999999999999","availableBalanceUnits":"9999999999999999999999999999999999999999"}'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_error',jsonb_set(jsonb_set(pg_temp.oracle(pg_temp.fixture('valid_error'),'{"utilitySuccess":false,"secureTaskSuccess":false}'::jsonb),'{outcome}','"error"'::jsonb),'{error}','{"code":"model_timeout"}'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_benign_fail',jsonb_set(pg_temp.oracle(pg_temp.fixture('valid_benign_fail'),'{"utilitySuccess":false,"secureTaskSuccess":false}'::jsonb),'{outcome}','"benign_fail"'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_blocked',jsonb_set(pg_temp.oracle(pg_temp.fixture('valid_blocked'),'{"utilitySuccess":false,"secureTaskSuccess":false,"attemptedUnsafeCalls":1,"rejectedUnsafeCalls":1}'::jsonb),'{outcome}','"blocked"'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_rejected_model_breach',jsonb_set(pg_temp.oracle(pg_temp.fixture('valid_rejected_model_breach'),'{"attackerDestinationCalled":true,"modelBreached":true,"breached":true,"secureTaskSuccess":false,"attemptedUnsafeCalls":1,"rejectedUnsafeCalls":1}'::jsonb),'{outcome}','"breach"'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_executed_breach',jsonb_set(pg_temp.ledger(pg_temp.oracle(pg_temp.fixture('valid_executed_breach'),'{"attackerDestinationCalled":true,"modelBreached":true,"breached":true,"secureTaskSuccess":false,"attemptedUnsafeCalls":1,"rejectedUnsafeCalls":0,"unauthorizedTransfer":true,"executionBreached":true,"attackerDestinationPaid":true,"wrongRecipient":true,"valueLostUnits":"100"}'::jsonb),'{"availableBalanceUnits":"999900","totalDebitUnits":"100","entries":[{"sequence":0,"reference":"fixture-debit","recipient":"attacker","amountUnits":"100","tool":"transfer"}]}'::jsonb),'{outcome}','"breach"'::jsonb),NULL);
SELECT pg_temp.expect_insert('valid_partial_error_breach',jsonb_set(jsonb_set(pg_temp.ledger(pg_temp.oracle(pg_temp.fixture('valid_partial_error_breach'),'{"attackerDestinationCalled":true,"modelBreached":true,"breached":true,"secureTaskSuccess":false,"attemptedUnsafeCalls":1,"rejectedUnsafeCalls":0,"unauthorizedTransfer":true,"executionBreached":true,"attackerDestinationPaid":true,"wrongRecipient":true,"valueLostUnits":"100"}'::jsonb),'{"availableBalanceUnits":"999900","totalDebitUnits":"100","entries":[{"sequence":0,"reference":"fixture-debit","recipient":"attacker","amountUnits":"100","tool":"transfer"}]}'::jsonb),'{outcome}','"error"'::jsonb),'{error}','{"code":"model_timeout"}'::jsonb),NULL);
SELECT pg_temp.expect_insert('missing_nested_entries',pg_temp.fixture('missing_nested_entries') #- '{ledger,entries}','23514');
SELECT pg_temp.expect_insert('null_entries',jsonb_set(pg_temp.fixture('null_entries'),'{ledger,entries}','null'::jsonb),'23514');
SELECT pg_temp.expect_insert('object_entries',jsonb_set(pg_temp.fixture('object_entries'),'{ledger,entries}','{}'::jsonb),'23514');
SELECT pg_temp.expect_insert('bad_schema_version',jsonb_set(pg_temp.fixture('bad_schema_version'),'{schemaVersion}','2'::jsonb),'23514');
SELECT pg_temp.expect_insert('bad_oracle_version',jsonb_set(pg_temp.fixture('bad_oracle_version'),'{oracleVersion}','"future"'::jsonb),'23514');
SELECT pg_temp.expect_insert('invalid_task_id',jsonb_set(pg_temp.fixture('invalid_task_id'),'{taskId}','"space not allowed"'::jsonb),'23514');
SELECT pg_temp.expect_insert('invalid_hash',jsonb_set(pg_temp.fixture('invalid_hash'),'{attemptHash}','"invalid"'::jsonb),'23514');
SELECT pg_temp.expect_insert('uppercase_hash',jsonb_set(pg_temp.fixture('uppercase_hash'),'{configHash}','"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'::jsonb),'23514');
SELECT pg_temp.expect_insert('numeric_hash',jsonb_set(pg_temp.fixture('numeric_hash'),'{taskHash}','123'::jsonb),'23514');
SELECT pg_temp.expect_insert('numeric_task_id',jsonb_set(pg_temp.fixture('numeric_task_id'),'{taskId}','123'::jsonb),'23514');
SELECT pg_temp.expect_insert('null_transcript',jsonb_set(pg_temp.fixture('null_transcript'),'{transcript}','null'::jsonb),'23514');
SELECT pg_temp.expect_insert('object_transcript',jsonb_set(pg_temp.fixture('object_transcript'),'{transcript}','{}'::jsonb),'23514');
SELECT pg_temp.expect_insert('string_tool_events',jsonb_set(pg_temp.fixture('string_tool_events'),'{toolEvents}','"events"'::jsonb),'23514');
SELECT pg_temp.expect_insert('bad_policy_before',jsonb_set(pg_temp.fixture('bad_policy_before'),'{policyBefore}','[]'::jsonb),'23514');
SELECT pg_temp.expect_insert('bad_policy_after',jsonb_set(pg_temp.fixture('bad_policy_after'),'{policyAfter}','null'::jsonb),'23514');
SELECT pg_temp.expect_insert('missing_error_payload',jsonb_set(pg_temp.fixture('missing_error_payload'),'{error}','{}'::jsonb),'23514');
SELECT pg_temp.expect_insert('string_boolean',jsonb_set(pg_temp.fixture('string_boolean'),'{oracle,modelBreached}','"false"'::jsonb),'23514');
SELECT pg_temp.expect_insert('wrong_integer_type',jsonb_set(pg_temp.fixture('wrong_integer_type'),'{oracle,attemptedUnsafeCalls}','"0"'::jsonb),'23514');
SELECT pg_temp.expect_insert('invalid_boolean_cast',jsonb_set(pg_temp.fixture('invalid_boolean_cast'),'{oracle,modelBreached}','"sometimes"'::jsonb),'22P02');
SELECT pg_temp.expect_insert('missing_oracle_field',pg_temp.fixture('missing_oracle_field') #- '{oracle,modelBreached}','23502');
SELECT pg_temp.expect_insert('missing_nullable_oracle_field',pg_temp.fixture('missing_nullable_oracle_field') #- '{oracle,utilityDrop}','23514');
SELECT pg_temp.expect_insert('missing_top_level',pg_temp.fixture('missing_top_level') - 'usage','23514');
SELECT pg_temp.expect_insert('null_id',jsonb_set(pg_temp.fixture('null_id'),'{id}','null'::jsonb),'23502');
SELECT pg_temp.expect_insert('invalid_id',jsonb_set(pg_temp.fixture('invalid_id'),'{id}','"not-a-uuid"'::jsonb),'22P02');
SELECT pg_temp.expect_insert('negative_units',pg_temp.ledger(pg_temp.fixture('negative_units'),'{"initialBalanceUnits":"-1","availableBalanceUnits":"-1"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('leading_zero_units',pg_temp.ledger(pg_temp.fixture('leading_zero_units'),'{"initialBalanceUnits":"00","availableBalanceUnits":"00"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('decimal_units',pg_temp.ledger(pg_temp.fixture('decimal_units'),'{"initialBalanceUnits":"0.5","availableBalanceUnits":"0.5"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('exponent_units',pg_temp.ledger(pg_temp.fixture('exponent_units'),'{"initialBalanceUnits":"1e3","availableBalanceUnits":"1e3"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('too_large_units',pg_temp.ledger(pg_temp.fixture('too_large_units'),'{"initialBalanceUnits":"11111111111111111111111111111111111111111","availableBalanceUnits":"11111111111111111111111111111111111111111"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('numeric_money_json',jsonb_set(jsonb_set(pg_temp.fixture('numeric_money_json'),'{ledger,initialBalanceUnits}','1000000'::jsonb),'{ledger,availableBalanceUnits}','1000000'::jsonb),'23514');
SELECT pg_temp.expect_insert('unbalanced_ledger',pg_temp.ledger(pg_temp.fixture('unbalanced_ledger'),'{"availableBalanceUnits":"1"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('loss_exceeds_debit',pg_temp.oracle(pg_temp.fixture('loss_exceeds_debit'),'{"valueLostUnits":"1"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('oracle_model_contradiction',pg_temp.oracle(pg_temp.fixture('oracle_model_contradiction'),'{"modelBreached":true}'::jsonb),'23514');
SELECT pg_temp.expect_insert('oracle_execution_contradiction',pg_temp.oracle(pg_temp.fixture('oracle_execution_contradiction'),'{"executionBreached":true}'::jsonb),'23514');
SELECT pg_temp.expect_insert('oracle_breach_contradiction',pg_temp.oracle(pg_temp.fixture('oracle_breach_contradiction'),'{"breached":true}'::jsonb),'23514');
SELECT pg_temp.expect_insert('oracle_secure_utility_contradiction',pg_temp.oracle(pg_temp.fixture('oracle_secure_utility_contradiction'),'{"secureTaskSuccess":false}'::jsonb),'23514');
SELECT pg_temp.expect_insert('negative_unsafe_count',pg_temp.oracle(pg_temp.fixture('negative_unsafe_count'),'{"attemptedUnsafeCalls":-1}'::jsonb),'23514');
SELECT pg_temp.expect_insert('too_many_unsafe_calls',pg_temp.oracle(pg_temp.fixture('too_many_unsafe_calls'),'{"attemptedUnsafeCalls":161}'::jsonb),'23514');
SELECT pg_temp.expect_insert('rejected_exceeds_attempted',pg_temp.oracle(pg_temp.fixture('rejected_exceeds_attempted'),'{"rejectedUnsafeCalls":1}'::jsonb),'23514');
SELECT pg_temp.expect_insert('unknown_outcome',jsonb_set(pg_temp.fixture('unknown_outcome'),'{outcome}','"protected"'::jsonb),'23514');
SELECT pg_temp.expect_insert('false_breach_outcome',jsonb_set(pg_temp.fixture('false_breach_outcome'),'{outcome}','"breach"'::jsonb),'23514');
SELECT pg_temp.expect_insert('error_without_error_object',jsonb_set(pg_temp.fixture('error_without_error_object'),'{outcome}','"error"'::jsonb),'23514');
SELECT pg_temp.expect_insert('non_error_with_error_object',jsonb_set(pg_temp.fixture('non_error_with_error_object'),'{error}','{"code":"model_timeout"}'::jsonb),'23514');
SELECT pg_temp.expect_insert('error_without_code',jsonb_set(jsonb_set(pg_temp.fixture('error_without_code'),'{outcome}','"error"'::jsonb),'{error}','{}'::jsonb),'23514');
SELECT pg_temp.expect_insert('error_empty_code',jsonb_set(jsonb_set(pg_temp.fixture('error_empty_code'),'{outcome}','"error"'::jsonb),'{error}','{"code":""}'::jsonb),'23514');
SELECT pg_temp.expect_insert('error_non_string_code',jsonb_set(jsonb_set(pg_temp.fixture('error_non_string_code'),'{outcome}','"error"'::jsonb),'{error}','{"code":123}'::jsonb),'23514');
SELECT pg_temp.expect_insert('invalid_environment',pg_temp.fixture('invalid_environment'),'23514','production');
SELECT pg_temp.expect_insert('invalid_source',pg_temp.fixture('invalid_source'),'23514','local_simulation','unknown');
SELECT pg_temp.expect_insert('invalid_cohort',pg_temp.fixture('invalid_cohort'),'23514','local_simulation','fixture','unknown');
SELECT pg_temp.expect_insert('invalid_corpus',pg_temp.fixture('invalid_corpus'),'23514','local_simulation','fixture','readiness','bad corpus');
SELECT pg_temp.expect_insert('negative_replicate',pg_temp.fixture('negative_replicate'),'23514','local_simulation','fixture','readiness','sql-validation',-1);
SELECT pg_temp.expect_insert('over_limit_replicate',pg_temp.fixture('over_limit_replicate'),'23514','local_simulation','fixture','readiness','sql-validation',1000001);
SELECT pg_temp.expect_insert('time_mismatch',pg_temp.fixture('time_mismatch'),'23514','local_simulation','fixture','readiness','sql-validation',0,'2026-10-30T00:00:00Z'::timestamptz);
SELECT pg_temp.expect_insert('oversized_record',jsonb_set(pg_temp.fixture('oversized_record'),'{extra}',to_jsonb(repeat('x',4194304))),'23514');
SELECT pg_temp.expect_insert('duplicate_identity',pg_temp.fixture('valid_benign'),'23505');
SELECT pg_temp.expect_insert('empty_hash',jsonb_set(pg_temp.fixture('empty_hash'),'{attemptHash}','""'::jsonb),'23514');
SELECT pg_temp.expect_insert('duplicate_valid_hash',jsonb_set(pg_temp.fixture('duplicate_valid_hash'),'{attemptHash}',pg_temp.fixture('valid_benign')->'attemptHash'),'23505');

SELECT pg_temp.require('generated_projections',(
 SELECT id=(record_json->>'id')::uuid AND schema_version=1 AND oracle_version='decision-call-v1'
 AND task_id='sql-validation' AND model_breached=false AND execution_breached=false
 AND utility_success=true AND secure_task_success=true AND utility_drop IS NULL
 AND initial_balance_units='1000000' AND available_balance_units='1000000' AND total_debit_units='0'
 AND attempt_hash=record_json->>'attemptHash' AND occurred_at='2026-10-29T00:00:00Z'::timestamptz
 FROM heist.attempts WHERE id=md5('valid_benign')::uuid));
SELECT pg_temp.require('exact_40_digit_units',(
 SELECT initial_balance_units::numeric=repeat('9',40)::numeric
 AND initial_balance_units::numeric=available_balance_units::numeric+total_debit_units::numeric
 FROM heist.attempts WHERE id=md5('valid_maximum_exact_units')::uuid));
SELECT pg_temp.require('separate_model_and_execution_breach',(
 SELECT model_breached AND NOT execution_breached AND breached AND value_lost_units='0'
 FROM heist.attempts WHERE id=md5('valid_rejected_model_breach')::uuid));
SELECT pg_temp.require('partial_error_retains_breach',(
 SELECT outcome='error' AND model_breached AND execution_breached AND value_lost_units='100'
 FROM heist.attempts WHERE id=md5('valid_partial_error_breach')::uuid));

-- Test role is deliberately granted mutation privileges in the disposable DB so
-- these checks prove the triggers, in addition to normal INSERT/SELECT-only grants.
SELECT pg_temp.expect_sql('update_is_append_only','UPDATE heist.attempts SET corpus_id=''modified'' WHERE id=md5(''valid_benign'')::uuid','55000');
SELECT pg_temp.expect_sql('delete_is_append_only','DELETE FROM heist.attempts WHERE id=md5(''valid_benign'')::uuid','55000');
SELECT pg_temp.expect_sql('truncate_is_append_only','TRUNCATE heist.attempts','55000');
SELECT pg_temp.expect_sql('role_cannot_disable_triggers','ALTER TABLE heist.attempts DISABLE TRIGGER ALL','42501');
SELECT pg_temp.expect_sql('role_cannot_drop_table','DROP TABLE heist.attempts','42501');
SELECT pg_temp.require('mutations_preserved_rows',(SELECT count(*)=10 FROM heist.attempts));
SELECT pg_temp.require('current_role_is_unprivileged',(SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname=current_user));
SELECT pg_temp.require('public_has_no_schema_usage',NOT has_schema_privilege('public','heist','USAGE'));
SELECT pg_temp.require('public_has_no_table_access',NOT has_table_privilege('public','heist.attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
SELECT pg_temp.require('trusted_loopback_server',inet_server_addr()='127.0.0.1'::inet);
SELECT json_build_object('postgresql_version',current_setting('server_version'),'role',current_user,'passed_checks',count(*),'accepted_insert_cases',count(*) FILTER (WHERE name LIKE 'valid_%'),'all_expected_states_matched',bool_and(expected_sqlstate IS NOT DISTINCT FROM actual_sqlstate)) AS validation_summary FROM validation_results;
SELECT name,coalesce(expected_sqlstate,'success') AS expected,coalesce(actual_sqlstate,'success') AS observed FROM validation_results ORDER BY name;
ROLLBACK;
