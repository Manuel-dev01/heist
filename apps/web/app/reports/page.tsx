import type { Metadata } from 'next';
import { ReportInspector } from '../../components/report-inspector';

export const metadata: Metadata = {
  title: 'HEIST — Local report inspector',
  description: 'Inspect a manually selected benchmark report locally, with coverage, operational errors, declared metrics and a browser SHA-256 content check.',
};

export default function ReportsPage() {
  return <ReportInspector />;
}
