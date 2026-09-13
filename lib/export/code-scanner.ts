/**
 * Code Security & Structural Scanner
 * Audits virtual project files before pushing to remote repositories.
 */

export interface ScanIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'security' | 'structure' | 'quality';
  file?: string;
  line?: number;
  message: string;
  recommendation: string;
}

export interface ScanReport {
  timestamp: string;
  totalFiles: number;
  totalLines: number;
  hasCriticalIssues: boolean;
  score: number; // 0 - 100
  issues: ScanIssue[];
  stats: {
    tsCount: number;
    jsCount: number;
    cssCount: number;
    assetCount: number;
    hasPackageJson: boolean;
    hasIndexHtml: boolean;
    hasReadme: boolean;
  };
}

// Regex patterns for detecting leaked secrets and credentials
const SECRET_PATTERNS: { name: string; regex: RegExp; severity: 'critical' | 'warning' }[] = [
  {
    name: 'Gemini API Key',
    regex: /AIza[0-9A-Za-z-_]{35}/g,
    severity: 'critical',
  },
  {
    name: 'OpenAI API Key',
    regex: /sk-[a-zA-Z0-9]{32,}/g,
    severity: 'critical',
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /ghp_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
  },
  {
    name: 'Generic Private Key',
    regex: /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP)? ?PRIVATE KEY-----/g,
    severity: 'critical',
  },
  {
    name: 'Supabase Service Role Key',
    regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.[a-zA-Z0-9-_]+.[a-zA-Z0-9-_]+/g,
    severity: 'warning',
  },
  {
    name: 'Anthropic API Key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
    severity: 'critical',
  },
  {
    name: 'Groq API Key',
    regex: /\bgsk_[A-Za-z0-9_-]{32,}\b/g,
    severity: 'critical',
  },
  {
    name: 'GitHub Fine-Grained Personal Access Token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    severity: 'critical',
  },
  {
    name: 'Stripe Secret Key',
    regex: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    severity: 'critical',
  },
  {
    name: 'PostgreSQL Connection URI with Password',
    regex: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/gi,
    severity: 'critical',
  },
  {
    name: 'Generic Hardcoded Secret/Token assignment',
    regex: /(?:api_key|apikey|secret_key|private_key|auth_token)s*[:=]s*['"][a-zA-Z0-9-_]{20,}['"]/gi,
    severity: 'warning',
  },
];

export function runCodeScan(files: Record<string, string>): ScanReport {
  const issues: ScanIssue[] = [];
  let totalLines = 0;
  let tsCount = 0;
  let jsCount = 0;
  let cssCount = 0;
  let assetCount = 0;
  let hasPackageJson = false;
  let hasIndexHtml = false;
  let hasReadme = false;

  const fileEntries = Object.entries(files);

  for (const [pathKey, content] of fileEntries) {
    const cleanPath = pathKey.replace(/^\/+/, '');
    const lines = content.split('\n');
    totalLines += lines.length;

    // File type tracking
    if (cleanPath.endsWith('.ts') || cleanPath.endsWith('.tsx')) tsCount++;
    else if (cleanPath.endsWith('.js') || cleanPath.endsWith('.jsx')) jsCount++;
    else if (cleanPath.endsWith('.css') || cleanPath.endsWith('.scss')) cssCount++;
    else if (cleanPath.match(/\.(png|jpg|jpeg|gif|svg|ico)$/i)) assetCount++;

    if (cleanPath === 'package.json') hasPackageJson = true;
    if (cleanPath === 'index.html') hasIndexHtml = true;
    if (cleanPath.toLowerCase() === 'readme.md') hasReadme = true;

    // Detect .env files committed
    if (cleanPath === '.env' || cleanPath.endsWith('/.env')) {
      issues.push({
        id: `env-file-${cleanPath}`,
        severity: 'critical',
        category: 'security',
        file: cleanPath,
        message: 'Raw .env file detected in virtual repository.',
        recommendation: 'Do not commit .env files containing production secrets. Use .env.example instead.',
      });
    }

    // Secret scans across line content
    lines.forEach((lineText, lineIdx) => {
      SECRET_PATTERNS.forEach((pattern) => {
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(lineText)) {
          issues.push({
            id: `secret-${pattern.name}-${cleanPath}-${lineIdx + 1}`,
            severity: pattern.severity,
            category: 'security',
            file: cleanPath,
            line: lineIdx + 1,
            message: `Potential hardcoded secret detected: ${pattern.name}`,
            recommendation: 'Extract this secret into environment variables or secrets manager.',
          });
        }
      });
    });

    // Syntax sanity check for package.json
    if (cleanPath === 'package.json') {
      try {
        JSON.parse(content);
      } catch (err) {
        issues.push({
          id: 'invalid-package-json',
          severity: 'critical',
          category: 'structure',
          file: 'package.json',
          message: 'package.json contains invalid JSON syntax.',
          recommendation: 'Verify package.json formatting before pushing to avoid build failures.',
        });
      }
    }
  }

  // Structural sanity checks
  if (!hasPackageJson) {
    issues.push({
      id: 'missing-package-json',
      severity: 'warning',
      category: 'structure',
      message: 'No package.json file found.',
      recommendation: 'Add a package.json file to allow standard package managers (pnpm/npm) to run the project.',
    });
  }

  if (!hasIndexHtml) {
    issues.push({
      id: 'missing-index-html',
      severity: 'info',
      category: 'structure',
      message: 'No root index.html found (Vite projects typically require index.html).',
      recommendation: 'Ensure your app entry point is clearly defined.',
    });
  }

  if (!hasReadme) {
    issues.push({
      id: 'missing-readme',
      severity: 'info',
      category: 'quality',
      message: 'No README.md documentation file found.',
      recommendation: 'A README.md will be automatically created during push if omitted.',
    });
  }

  const hasCriticalIssues = issues.some((i) => i.severity === 'critical');

  let deductions = 0;
  issues.forEach((i) => {
    if (i.severity === 'critical') deductions += 35;
    else if (i.severity === 'warning') deductions += 15;
    else deductions += 5;
  });
  const score = Math.max(0, 100 - deductions);

  return {
    timestamp: new Date().toISOString(),
    totalFiles: fileEntries.length,
    totalLines,
    hasCriticalIssues,
    score,
    issues,
    stats: {
      tsCount,
      jsCount,
      cssCount,
      assetCount,
      hasPackageJson,
      hasIndexHtml,
      hasReadme,
    },
  };
}
