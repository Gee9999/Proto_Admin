import CustomerAnalysisPanel from './CustomerAnalysisPanel';
import { customerIqFixture } from '../lib/customerIq';

export default function CustomerAnalysisPreview() {
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: 20 }}>
      <CustomerAnalysisPanel analysis={customerIqFixture} />
    </div>
  );
}
