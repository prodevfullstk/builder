export type SkillCategory = 'engineering' | 'productivity' | 'architecture';

export interface Skill {
  id: string;
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  defaultActiveInModes?: ('build' | 'auto-fix' | 'visual-fix' | 'chat' | 'edit')[];
  promptContent: string;
}
