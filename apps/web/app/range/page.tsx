import { Arena } from '../../components/arena';
import { AppHeader, Eyebrow, Page } from '../../components/chrome';
import { C, css } from '../../lib/css';

export const metadata = { title: 'Practice range · HEIST' };

export default function RangePage() {
  return (
    <Page>
      <AppHeader active="RANGE" right={<div style={css(`border:1px solid #2f343b;padding:5px 8px;color:${C.gold}`)}>SCRIPTED FIXTURES · NO REAL FUNDS</div>} />
      <div className="hx-wrap" style={css('padding:36px clamp(16px,2.4vw,28px) 0;display:flex;flex-direction:column;gap:10px;max-width:900px;margin:0')}>
        <Eyebrow color={C.gold}>PRACTICE RANGE · RUN IT YOURSELF</Eyebrow>
        <h1 style={css('margin:0;font-weight:700;font-size:clamp(34px,4.6vw,52px);line-height:.95;letter-spacing:-.03em')}>Pick an attack. Choose the executor. Read the verdict.</h1>
        <div style={css(`font-size:16px;color:${C.dim};line-height:1.5`)}>Each run drives the real HEIST harness and oracle with a scripted agent decision, so you can see exactly how policy enforcement changes the outcome. Every record is hashed and you can verify it on the spot.</div>
      </div>
      <Arena />
    </Page>
  );
}
