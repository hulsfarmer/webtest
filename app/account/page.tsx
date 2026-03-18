'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { User, CreditCard, ExternalLink, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface SubscriptionInfo {
  portalUrl: string | null;
  plan: string;
  monthlyUsage: number;
  usageLimit: number;
}

const PLAN_LABELS: Record<string, string> = {
  free: '무료',
  pro: 'Pro',
  business: 'Business',
};

const PLAN_LIMITS: Record<string, number> = {
  free: 3,
  pro: 30,
  business: 100,
};

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (!session?.user) return;

    Promise.all([
      fetch('/api/subscription').then(r => r.json()),
      fetch('/api/usage').then(r => r.json()),
    ]).then(([sub, usage]) => {
      const plan = usage.plan || 'free';
      setInfo({
        portalUrl: sub.portalUrl || null,
        plan,
        monthlyUsage: usage.monthlyUsage || 0,
        usageLimit: PLAN_LIMITS[plan] || 3,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#0B0A14] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!session?.user) return null;

  const user = session.user;

  return (
    <div className="min-h-screen bg-[#0B0A14] pt-24 pb-16 px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/promo"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          돌아가기
        </Link>

        <h1 className="text-2xl font-bold text-white">내 계정</h1>

        {/* 프로필 */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center gap-4">
            {user.image ? (
              <img src={user.image} alt="" className="w-14 h-14 rounded-full" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-purple-500/20 flex items-center justify-center">
                <User className="w-6 h-6 text-purple-400" />
              </div>
            )}
            <div>
              <p className="text-lg font-semibold text-white">{user.name || '사용자'}</p>
              <p className="text-sm text-gray-400">{user.email}</p>
            </div>
          </div>
        </div>

        {/* 구독 정보 */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">구독 정보</h2>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">현재 플랜</span>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                info?.plan === 'business'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : info?.plan === 'pro'
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'bg-white/10 text-gray-300 border border-white/10'
              }`}>
                {PLAN_LABELS[info?.plan || 'free']}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-400">이번 달 사용량</span>
              <span className="text-white">
                {info?.monthlyUsage || 0} / {info?.usageLimit || 3}회
              </span>
            </div>

            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(((info?.monthlyUsage || 0) / (info?.usageLimit || 3)) * 100, 100)}%` }}
              />
            </div>
          </div>

          <div className="pt-2 space-y-3">
            {info?.portalUrl ? (
              <>
                <a
                  href={info.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  구독 관리 (결제 수단 변경 / 취소)
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <p className="text-xs text-gray-500 text-center">
                  LemonSqueezy 포털에서 결제 수단 변경, 구독 취소, 영수증 확인이 가능합니다.
                </p>
              </>
            ) : info?.plan === 'free' ? (
              <Link
                href="/#pricing"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold hover:opacity-90 transition-opacity"
              >
                플랜 업그레이드
              </Link>
            ) : (
              <p className="text-sm text-gray-500 text-center">
                구독 정보를 불러오는 중 문제가 발생했습니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
