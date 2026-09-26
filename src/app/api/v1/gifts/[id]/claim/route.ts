import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { getGiftById, hashPhone } from "@/server/services/gift.service";
import { claimGift } from "@/server/services/claim.service";
import { claimGiftSchema } from "@/types/schemas";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { getInvitationByPhoneAndGift, claimInvitation } from "@/server/services/invitation.service";
import type { ApiResponse } from "@/types";

export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest, context: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { params } = context as { params: { id: string } };

    const body = await req.json();
    // Merge route param id into the parsed body for validation
    const parsed = claimGiftSchema.safeParse({ ...body, giftId: params.id });

    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Always use the route param id — never trust body for giftId
    const giftId = params.id;
    const gift = await getGiftById(giftId);

    // Return 404 for non-existent or cross-user guesses (avoids enumeration)
    if (!gift) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Gift not found" },
        { status: 404 }
      );
    }

    // ── Ownership check ───────────────────────────────────────────────────────
    // Only the intended recipient may claim. Compare the hashed phone from the
    // session against the stored recipientPhoneHash. Return 404 rather than 403
    // to avoid leaking whether a gift exists for a different user.
    const phone = (session.user as { phone?: string }).phone;
    if (phone) {
      const sessionPhoneHash = hashPhone(phone);
      if (gift.recipientPhoneHash !== sessionPhoneHash) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Gift not found" },
          { status: 404 }
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Check if there's an invitation for this gift and recipient
    if (phone) {
      const invitation = await getInvitationByPhoneAndGift(phone, giftId);
      if (invitation) {
        // Invitation exists for this gift and recipient
        if (invitation.status !== "accepted") {
          return NextResponse.json<ApiResponse<never>>(
            {
              success: false,
              error: "You must complete registration via the invitation to claim this gift",
            },
            { status: 403 }
          );
        }
        // Mark invitation as claimed
        await claimInvitation(invitation.id);
      }
    }

    const { txHash } = await claimGift(gift, parsed.data.recipientStellarKey);

    return NextResponse.json<ApiResponse<{ txHash: string }>>({
      success: true,
      data: { txHash },
    });
  })
);
