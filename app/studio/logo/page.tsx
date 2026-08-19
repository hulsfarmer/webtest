import './logomaker.css';
import LogoStudio from './LogoStudio';
import AdminOnly from '@/components/studio/AdminOnly';

export const metadata = { title: '로고 생성' };

export default function Page() {
  return (
    <AdminOnly>
      <LogoStudio />
    </AdminOnly>
  );
}
