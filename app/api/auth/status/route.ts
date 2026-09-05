import { NextResponse } from "next/server";import { currentUser,initAuth } from "../../../../lib/auth";import { getRuntimeDb } from "../../../../db/runtime";
export async function GET(){await initAuth();const count=await getRuntimeDb().prepare("SELECT COUNT(*) total FROM users").first<{total:number}>();return NextResponse.json({setupRequired:!count?.total,user:await currentUser()})}
