import { AppHeader, Eyebrow, Page } from '../../components/chrome';
import { LiveVault } from '../../components/live-vault';
import { C, css } from '../../lib/css';

export const metadata = { title: 'Rob the vault · HEIST' };

export default function RobPage() {
  return (
    <Page>
      <AppHeader active="ROB IT" right={<div style={css(`border:1px solid ${C.red};padding:5px 8px;color:${C.red}`)}>LIVE MODEL · SYNTHETIC MONEY</div>} />
      <div className="hx-wrap">
        <div style={css('padding:36px clamp(16px,2.4vw,28px) 24px;display:flex;flex-direction:column;gap:10px;max-width:900px')}>
          <Eyebrow color={C.red}>LIVE VAULT · OPEN SAFE · RAW GPT-5.4-NANO ON SERV</Eyebrow>
          <h1 style={css('margin:0;font-weight:700;font-size:clamp(36px,5vw,58px);line-height:.95;letter-spacing:-.03em')}>Rob the vault. For real.</h1>
          <div style={css(`font-size:16px;color:${C.dim};line-height:1.5`)}>This is the one vault that has been robbed: once in 1,500 measured attempts. Write an injection, hide it in a chat, a web page or an inbox, and HEIST runs it live through the same harness and oracle as the measured runs. The verdict is decided by code over the ledger and tool calls, and you get the hashed record.</div>
        </div>
        <LiveVault />
      </div>
    </Page>
  );
}
