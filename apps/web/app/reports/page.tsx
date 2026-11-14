import type { Metadata } from 'next';
import { ReportInspector } from '../../components/report-inspector';
import { AppHeader, Page } from '../../components/chrome';

export const metadata: Metadata = { title: 'Report inspector · HEIST' };

export default function Page_() {
  return <Page><AppHeader active="DEFENSE CURVE" /><ReportInspector /></Page>;
}
