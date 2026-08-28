import '../logo/logomaker.css';
import AiSetDesigner from './AiSetDesigner';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '유튜브 배너·프로필' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="banner" />
      <AiSetDesigner />
    </>
  );
}
