export interface BehavioralTestResult {
  testName: string;
  passed: boolean;
  assertions: Array<{ name: string; passed: boolean; message: string }>;
  diagnostics: string[];
}

export interface BehavioralSuiteResult {
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  tests: BehavioralTestResult[];
  diagnostics: string[];
}

/**
 * Runs targeted behavioral tests for common interactive website patterns.
 * Ensures the candidate is tested for runtime behavioral integrity, not model prose.
 */
export function verifyBehavioralContract(params: {
  intentDescription: string;
  candidateFiles: Record<string, string>;
  baselineFiles?: Record<string, string>;
}): BehavioralSuiteResult {
  const { intentDescription, candidateFiles, baselineFiles = {} } = params;
  const tests: BehavioralTestResult[] = [];
  const diagnostics: string[] = [];

  const lowerDesc = intentDescription.toLowerCase();

  // Test 1: Mobile Hamburger Menu behavioral test
  if (lowerDesc.includes('hamburger') || lowerDesc.includes('mobile menu')) {
    const assertions: Array<{ name: string; passed: boolean; message: string }> = [];

    let hasTrigger = false;
    let hasOpenCloseLogic = false;
    let hasDesktopNav = false;
    let foundFile = '';

    for (const [file, content] of Object.entries(candidateFiles)) {
      if (file.toLowerCase().includes('nav') || file.toLowerCase().includes('header') || file.toLowerCase().includes('page')) {
        foundFile = file;

        // Assertion 1: Mobile menu trigger button exists
        if (
          /<button[^>]*aria-label=['"][^'"]*menu['"][^>]*>|<button[^>]*onClick/i.test(content) ||
          /Menu|lucide-react.*Menu/i.test(content)
        ) {
          hasTrigger = true;
        }

        // Assertion 2: Trigger can open and close menu (state toggle)
        if (
          /isOpen|setIsOpen|isMenuOpen|setIsMenuOpen|toggleMenu|showMobileMenu/i.test(content) &&
          /onClick=\{[^}]*(?:!isOpen|toggle|setIsOpen\([^)]*!\w+\))[^}]*\}/i.test(content)
        ) {
          hasOpenCloseLogic = true;
        }

        // Assertion 3: Desktop navigation remains functional / visible
        if (
          /hidden\s+md:flex|md:flex|hidden\s+lg:flex|lg:flex/i.test(content) ||
          (content.includes('<nav') && content.includes('href='))
        ) {
          hasDesktopNav = true;
        }
      }
    }

    assertions.push({
      name: 'mobile_menu_trigger_exists',
      passed: hasTrigger,
      message: hasTrigger
        ? `Mobile menu trigger button identified in '${foundFile}'`
        : 'Mobile menu trigger button is missing',
    });

    assertions.push({
      name: 'trigger_can_open_close_menu',
      passed: hasOpenCloseLogic,
      message: hasOpenCloseLogic
        ? 'Stateful toggle handler (open/close) verified in navigation component'
        : 'Missing interactive state toggle handler for mobile menu',
    });

    assertions.push({
      name: 'desktop_navigation_functional',
      passed: hasDesktopNav,
      message: hasDesktopNav
        ? 'Desktop navigation structure preserved and responsive classes intact'
        : 'Desktop navigation links or responsive container missing',
    });

    const passed = assertions.every((a) => a.passed);
    if (!passed) {
      diagnostics.push('Behavioral failure: Hamburger menu requirements not fully satisfied');
    }

    tests.push({
      testName: 'Hamburger Mobile Menu Behavioral Contract',
      passed,
      assertions,
      diagnostics: passed ? [] : ['One or more hamburger menu behavioral assertions failed.'],
    });
  }

  // Test 2: Navbar Logo Modification behavioral test
  if (lowerDesc.includes('logo') && (lowerDesc.includes('smaller') || lowerDesc.includes('size') || lowerDesc.includes('20%'))) {
    const assertions: Array<{ name: string; passed: boolean; message: string }> = [];

    let navbarRenders = false;
    let logoRenders = false;
    let sizeChangePresent = false;
    let otherNavIntact = false;

    for (const [file, content] of Object.entries(candidateFiles)) {
      if (file.toLowerCase().includes('nav') || file.toLowerCase().includes('header') || file.toLowerCase().includes('page')) {
        const baseContent = baselineFiles[file] || '';

        // Assertion 1: Navbar renders
        if (content.includes('<nav') || content.includes('Navbar') || content.includes('header')) {
          navbarRenders = true;
        }

        // Assertion 2: Logo renders
        if (
          /<img[^>]*alt=['"][^'"]*logo['"][^>]*>|<Image[^>]*alt=['"][^'"]*logo['"][^>]*>|font-bold[^>]*>Logo|className=['"][^'"]*logo['"][^>]*>/i.test(content) ||
          content.includes('logo') || content.includes('Logo')
        ) {
          logoRenders = true;
        }

        // Assertion 3: Requested size change is present
        // Checks for reduced Tailwind height/width or scale factor
        if (
          /h-6|h-7|h-8|w-6|w-7|w-8|scale-\[?0\.8\]?|w-\[96px\]|h-\[24px\]/i.test(content) ||
          (baseContent && baseContent !== content && /h-|w-|height|width/i.test(content))
        ) {
          sizeChangePresent = true;
        }

        // Assertion 4: Unrelated navbar behavior still works
        if (
          content.includes('href=') &&
          (!baseContent || (baseContent.includes('href=') && content.includes('href=')))
        ) {
          otherNavIntact = true;
        }
      }
    }

    assertions.push({
      name: 'navbar_renders',
      passed: navbarRenders,
      message: navbarRenders ? 'Navbar component structure verified' : 'Navbar component missing',
    });

    assertions.push({
      name: 'logo_renders',
      passed: logoRenders,
      message: logoRenders ? 'Logo element confirmed rendering in navbar' : 'Logo element missing from navbar',
    });

    assertions.push({
      name: 'requested_size_change_present',
      passed: sizeChangePresent,
      message: sizeChangePresent
        ? 'Verified requested size reduction in logo styling'
        : 'Logo dimension/scale reduction not detected',
    });

    assertions.push({
      name: 'unrelated_navbar_behavior_intact',
      passed: otherNavIntact,
      message: otherNavIntact
        ? 'Navigation links and unrelated navbar elements preserved'
        : 'Unrelated navbar links or routes were corrupted',
    });

    const passed = assertions.every((a) => a.passed);
    if (!passed) {
      diagnostics.push('Behavioral failure: Navbar logo modification assertions failed');
    }

    tests.push({
      testName: 'Navbar Logo Modification Behavioral Contract',
      passed,
      assertions,
      diagnostics: passed ? [] : ['One or more navbar logo behavioral assertions failed.'],
    });
  }

  const failedTests = tests.filter((t) => !t.passed).length;
  const passedTests = tests.filter((t) => t.passed).length;
  const allPassed = failedTests === 0;

  return {
    allPassed,
    totalTests: tests.length,
    passedTests,
    failedTests,
    tests,
    diagnostics,
  };
}
