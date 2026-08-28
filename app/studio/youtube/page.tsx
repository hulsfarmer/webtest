import '../logo/logomaker.css';
import AiSetDesigner from './AiSetDesigner';
import AdminOnly from '@/components/studio/AdminOnly';

export const metadata = { title: '유튜브 디자인' };

export default function Page() {
  return (
    <AdminOnly>
      <AiSetDesigner />
    </AdminOnly>
  );
}
