import type { Metadata } from 'next';
import { AdaptiveSummaryInspector } from '../../../components/adaptive-summary-inspector';
import { AppHeader, Page } from '../../../components/chrome';

export const metadata: Metadata = { title: 'Adaptive summary inspector · HEIST' };

export default function Page_() {
  return <Page><AppHeader active="DEFENSE CURVE" /><AdaptiveSummaryInspector /></Page>;
}
