import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import axios from 'axios';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  }

  const { variantId } = await request.json();
  if (!variantId) {
    return NextResponse.json({ error: 'variantId required' }, { status: 400 });
  }

  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!apiKey || !storeId) {
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 });
  }

  try {
    const response = await axios.post(
      'https://api.lemonsqueezy.com/v1/checkouts',
      {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_options: {
              embed: false,
              media: false,
            },
            checkout_data: {
              email: session.user.email,
              billing_address: {
                country: 'KR',
              },
              custom: {
                user_id: (session.user as { id?: string }).id || '',
              },
            },
            product_options: {
              redirect_url: `${process.env.NEXTAUTH_URL}/promo?upgraded=true`,
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: storeId } },
            variant: { data: { type: 'variants', id: String(variantId) } },
            ...(process.env.LEMONSQUEEZY_DISCOUNT_ID ? {
              discount: { data: { type: 'discounts', id: process.env.LEMONSQUEEZY_DISCOUNT_ID } },
            } : {}),
          },
        },
      },
      {
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      }
    );

    const checkoutUrl = response.data?.data?.attributes?.url;
    return NextResponse.json({ url: checkoutUrl });
  } catch (err) {
    console.error('[Checkout] Error:', err);
    return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });
  }
}
