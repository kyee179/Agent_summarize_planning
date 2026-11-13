const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const espree = createRequire(require.resolve('eslint'))('espree');
const catalog = require('../src/i18n/zh-CN.json');
const root = path.join(__dirname, '..', 'src');
function files(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir,entry.name)) : /\.(jsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir,entry.name)] : []); }
function walk(node, visit) { if(!node||typeof node!=='object')return; visit(node); for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(item=>walk(item,visit));else if(value&&typeof value==='object')walk(value,visit);} }
test('UI catalog covers static translation keys and translated labels cannot become option values', () => {
  const missing=[];
  for(const file of files(root)){
    const ast=espree.parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}});
    walk(ast,node=>{
      if(node.type==='CallExpression'&&node.callee.name==='t'&&node.arguments[0]?.type==='Literal'){
        const key=node.arguments[0].value;
        if(typeof key==='string'&&!Object.hasOwn(catalog,key.trim()))missing.push(path.relative(root,file)+': '+key);
      }
      if(node.type==='JSXAttribute'&&['value','defaultValue','key'].includes(node.name.name))walk(node.value,child=>{
        assert.ok(!(child.type==='CallExpression'&&child.callee.name==='t'),'A saved value or React key must not depend on language in '+file);
      });
    });
  }
  assert.deepEqual(missing,[],'Missing Chinese UI translations');
});
