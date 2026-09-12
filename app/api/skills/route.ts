import { NextRequest, NextResponse } from 'next/server';
import { getAllSkills, getSkillById, getSkillsForMode } from '@/lib/skills/catalog';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const mode = searchParams.get('mode') as 'build' | 'auto-fix' | 'chat' | 'edit' | null;

  if (id) {
    const skill = getSkillById(id);
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found: ' + id }, { status: 404 });
    }
    return NextResponse.json({ skill });
  }

  if (mode) {
    const skills = getSkillsForMode(mode);
    return NextResponse.json({ skills, count: skills.length });
  }

  const skills = getAllSkills();
  return NextResponse.json({ skills, count: skills.length });
}
