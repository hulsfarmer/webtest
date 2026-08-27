import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim() || email.split('@')[0];

    // 유효성 검사
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '올바른 이메일을 입력하세요.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    // 이메일 중복 확인
    const { data: existing } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('email', email)
      .single();

    if (existing) {
      // 소셜로 이미 가입된 경우: 비밀번호만 설정 (계정 통합)
      if (!existing.password_hash) {
        const password_hash = await bcrypt.hash(password, 10);
        const { error } = await supabase
          .from('users')
          .update({ password_hash })
          .eq('id', existing.id);
        if (error) throw error;
        return NextResponse.json({ ok: true, linked: true });
      }
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('users').insert({
      id: crypto.randomUUID(),
      email,
      name,
      password_hash,
      credits: 0, // 가입 선물 5크레딧은 '쿠폰 받기'로 지급 (free_credit_month=null → 즉시 클레임 가능)
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[signup] error:', e);
    const msg = e instanceof Error ? e.message : '가입 처리 중 오류가 발생했습니다.';
    // password_hash 컬럼 미존재 등 스키마 오류 안내
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
