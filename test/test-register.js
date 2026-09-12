const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const sub = request.slice(2);
    let resolved = path.resolve(rootDir, sub);
    if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.ts')) {
      resolved = resolved + '.ts';
    } else if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.tsx')) {
      resolved = resolved + '.tsx';
    } else if (!fs.existsSync(resolved) && fs.existsSync(path.join(resolved, 'index.ts'))) {
      resolved = path.join(resolved, 'index.ts');
    }
    return origResolveFilename.call(this, resolved, parent, isMain, options);
  }
  if (!path.extname(request) && (request.startsWith('./') || request.startsWith('../'))) {
    const fromDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd();
    const candidate = path.resolve(fromDir, request);
    if (!fs.existsSync(candidate)) {
      if (fs.existsSync(candidate + '.ts')) {
        return origResolveFilename.call(this, candidate + '.ts', parent, isMain, options);
      }
      if (fs.existsSync(candidate + '.tsx')) {
        return origResolveFilename.call(this, candidate + '.tsx', parent, isMain, options);
      }
    }
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowJs: true,
      resolveJsonModule: true,
    },
  });

  let code = transpiled.outputText;
  code = code.replace(/require\(["']@\/(.+?)["']\)/g, (match, p1) => {
    let resolved = path.resolve(rootDir, p1);
    if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.ts')) {
      resolved = resolved + '.ts';
    } else if (!fs.existsSync(resolved) && fs.existsSync(path.join(resolved, 'index.ts'))) {
      resolved = path.join(resolved, 'index.ts');
    }
    return 'require(' + JSON.stringify(resolved) + ')';
  });

  module._compile(code, filename);
};