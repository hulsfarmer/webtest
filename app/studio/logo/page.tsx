import './logomaker.css';
import LogoStudio from './LogoStudio';
import MenuSample from '@/components/MenuSample';

export const metadata = { title: '로고 생성' };

export default function Page() {
  return (
    <>
      <MenuSample menuKey="logo" />
      <LogoStudio />
    </>
  );
}
