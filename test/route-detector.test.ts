import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectProjectRoutes } from '../lib/preview/route-detector';

describe('Route Detector Utility', () => {
  it('detects Next.js App Router multi-page routes accurately', () => {
    const files = {
      'app/page.tsx': 'export default function Home() { return <div>Home</div>; }',
      'app/shop/page.tsx': 'export default function Shop() { return <div>Shop</div>; }',
      'app/pricing/page.tsx': 'export default function Pricing() { return <div>Pricing</div>; }',
      'app/about/page.tsx': 'export default function About() { return <div>About</div>; }',
      'app/(auth)/login/page.tsx': 'export default function Login() { return <div>Login</div>; }',
      'app/dashboard/settings/page.tsx': 'export default function Settings() { return <div>Settings</div>; }',
    };

    const routes = detectProjectRoutes(files);
    const paths = routes.map((r) => r.path);

    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/shop'));
    assert.ok(paths.includes('/pricing'));
    assert.ok(paths.includes('/about'));
    assert.ok(paths.includes('/login'));
    assert.ok(paths.includes('/dashboard/settings'));

    const shopRoute = routes.find((r) => r.path === '/shop');
    assert.strictEqual(shopRoute?.label, 'Shop');
  });

  it('detects Vite React Router <Route path="..." /> definitions', () => {
    const files = {
      'src/App.tsx': `
        import { BrowserRouter, Routes, Route } from 'react-router-dom';
        export default function App() {
          return (
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/products" element={<Products />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/checkout" element={<Checkout />} />
              </Routes>
            </BrowserRouter>
          );
        }
      `,
    };

    const routes = detectProjectRoutes(files);
    const paths = routes.map((r) => r.path);

    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/products'));
    assert.ok(paths.includes('/cart'));
    assert.ok(paths.includes('/checkout'));
  });

  it('always returns root / when files are empty', () => {
    const routes = detectProjectRoutes({});
    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].path, '/');
    assert.strictEqual(routes[0].label, 'Home');
  });
});
