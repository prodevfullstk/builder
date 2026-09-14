import { ImageReference } from './image-hardening';

export interface VisualSpecSection {
  name: string;
  order: number;
  components: string[];
  layoutType: 'flex-row' | 'flex-col' | 'grid' | 'absolute';
  alignment: string;
  background: string;
  description: string;
}

export interface VisualSpecTypography {
  headingFont?: string;
  bodyFont?: string;
  headingSize?: string;
  bodySize?: string;
  weightHierarchy?: string[];
}

export interface VisualSpecTheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  borderRadius: string;
  boxShadow: string;
  spacingScale: string;
}

export interface VisualSpec {
  id: string;
  imageReferenceId?: string;
  viewport: {
    width: number;
    height: number;
    deviceType: 'desktop' | 'tablet' | 'mobile';
  };
  pageStructure: string[];
  sections: VisualSpecSection[];
  components: string[];
  layout: string;
  alignment: string;
  colors: VisualSpecTheme;
  typography: VisualSpecTypography;
  spacing: string;
  borders: string;
  radii: string;
  shadows: string;
  imagery: Array<{ type: 'logo' | 'hero-image' | 'avatar' | 'icon' | 'illustration'; description: string }>;
  responsiveBehavior: string;
  visualTargets: string[];
  uncertainties: string[];
  confidence: number;
  createdAt: string;
}

/**
 * Creates a structured VisualSpec from vision analysis data or parsed visual context.
 * Enables the implementation and validation pipeline to ground code generation in exact visual specifications.
 */
export function createVisualSpec(params: {
  imageReference?: ImageReference;
  visualPrompt?: string;
  detectedLayout?: Partial<VisualSpec>;
}): VisualSpec {
  const { imageReference, visualPrompt = '', detectedLayout = {} } = params;
  const id = 'vspec_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

  const defaultTheme: VisualSpecTheme = {
    primaryColor: '#2563eb', // blue-600
    secondaryColor: '#4f46e5', // indigo-600
    backgroundColor: '#ffffff',
    textColor: '#0f172a', // slate-900
    accentColor: '#38bdf8', // sky-400
    borderRadius: '0.5rem', // rounded-lg
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    spacingScale: '1rem',
  };

  const defaultTypography: VisualSpecTypography = {
    headingFont: 'Inter, sans-serif',
    bodyFont: 'Inter, sans-serif',
    headingSize: '2.25rem', // text-4xl
    bodySize: '1rem', // text-base
    weightHierarchy: ['font-bold', 'font-semibold', 'font-normal'],
  };

  const sections: VisualSpecSection[] = [
    {
      name: 'Navigation',
      order: 1,
      components: ['Navbar', 'Logo', 'NavLinks', 'CallToActionButton'],
      layoutType: 'flex-row',
      alignment: 'items-center justify-between',
      background: '#ffffff',
      description: 'Sticky header with brand logo on the left, links in center, and CTA on right',
    },
    {
      name: 'Hero',
      order: 2,
      components: ['Headline', 'Subheadline', 'PrimaryButton', 'SecondaryButton', 'HeroVisual'],
      layoutType: 'flex-col',
      alignment: 'items-center text-center',
      background: '#ffffff',
      description: 'Bold value proposition with dual CTAs and product graphic/mockup',
    },
    {
      name: 'Features / Sections',
      order: 3,
      components: ['FeatureGrid', 'FeatureCard', 'IconBadge'],
      layoutType: 'grid',
      alignment: 'grid-cols-1 md:grid-cols-3',
      background: '#f8fafc',
      description: 'Grid of highlight cards with iconography and concise descriptions',
    },
    {
      name: 'Footer',
      order: 4,
      components: ['FooterNavigation', 'CopyrightNotice', 'SocialIcons'],
      layoutType: 'flex-col',
      alignment: 'items-center',
      background: '#0f172a',
      description: 'Comprehensive footer with dark contrasting background',
    },
  ];

  return {
    id,
    imageReferenceId: imageReference?.id,
    viewport: detectedLayout.viewport || {
      width: 1280,
      height: 800,
      deviceType: 'desktop',
    },
    pageStructure: detectedLayout.pageStructure || ['Navbar', 'Hero', 'Features', 'Footer'],
    sections: detectedLayout.sections || sections,
    components: detectedLayout.components || ['Navbar', 'Hero', 'Features', 'Footer', 'Button'],
    layout: detectedLayout.layout || 'Single-page landing scroll with responsive flexbox/grid containers',
    alignment: detectedLayout.alignment || 'Centered container with max-w-7xl mx-auto padding',
    colors: { ...defaultTheme, ...detectedLayout.colors },
    typography: { ...defaultTypography, ...detectedLayout.typography },
    spacing: detectedLayout.spacing || 'py-16 md:py-24 px-4 sm:px-6 lg:px-8',
    borders: detectedLayout.borders || 'border border-slate-200 dark:border-slate-800',
    radii: detectedLayout.radii || 'rounded-lg md:rounded-xl',
    shadows: detectedLayout.shadows || 'shadow-sm hover:shadow-md transition-shadow',
    imagery: detectedLayout.imagery || [
      { type: 'logo', description: 'Vector brand icon and text logo' },
      { type: 'hero-image', description: 'Application preview card or illustration' },
    ],
    responsiveBehavior: detectedLayout.responsiveBehavior || 'Mobile stack (flex-col) adapting to desktop row (md:flex-row)',
    visualTargets: detectedLayout.visualTargets || ['Navbar.logo', 'Hero.heading', 'Hero.cta'],
    uncertainties: detectedLayout.uncertainties || (visualPrompt ? [] : ['Exact font family approximated from standard sans font stack']),
    confidence: detectedLayout.confidence ?? (imageReference ? 0.92 : 0.85),
    createdAt: new Date().toISOString(),
  };
}
