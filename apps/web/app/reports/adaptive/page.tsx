import type { Metadata } from 'next';
import { AdaptiveSummaryInspector } from '../../../components/adaptive-summary-inspector';

export const metadata: Metadata = {
  title: 'HEIST — Local adaptive summary inspector',
  description: 'Inspect a manually selected compact adaptive search summary locally. Original plan and result files are not verified in this browser.',
};

export default function AdaptiveReportsPage() {
  return <AdaptiveSummaryInspector />;
}
