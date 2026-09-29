/* Testes de unidade: pegam as funcoes direto do index.html (o app nao tem build) e
   conferem as regras que ja deram problema em producao.  node --test unidade.test.js */
process.env.TZ = "America/Sao_Paulo";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const trecho = (inicio, fim) => {
  const i = html.indexOf(inicio), j = html.indexOf(fim, i);
  assert.ok(i >= 0 && j > i, `trecho nao encontrado no index.html: ${inicio}`);
  return html.slice(i, j);
};

/* roda o codigo com "agora" fixo, no fuso de Brasilia */
function carrega(codigo, nomes, agoraISO) {
  const Real = Date, agora = agoraISO ? new Real(agoraISO).getTime() : null;
  class DataFixa extends Real {
    constructor(...a) { a.length || agora === null ? super(...a) : super(agora); }
    static now() { return agora ?? Real.now(); }
  }
  const ctx = { Date: agora === null ? Real : DataFixa, JSON, Object, Array, String, Math, isNaN, Set };
  vm.createContext(ctx);
  vm.runInContext(codigo + `\n;globalThis.__f={${nomes.join(",")}};`, ctx);
  return ctx.__f;
}

const codDif = trecho("const _ehMapa=", "const _FV=");
const codData = trecho("const dataLocal=", "const dataHoje=");
const codDias = trecho("function diasAte(", "function badgeVenc(");

test("dataLocal: inspecao as 22h30 do ultimo dia do mes fica no proprio mes", () => {
  const { dataLocal } = carrega(codData, ["dataLocal"], "2026-09-30T22:30:00-03:00");
  assert.strictEqual(dataLocal(), "2026-09-30");
  assert.strictEqual(dataLocal().slice(0, 7), "2026-09");
});

test("diasAte: vence no fim do dia informado (fuso de Brasilia)", () => {
  for (const hora of ["00:30", "10:00", "23:30"]) {
    const { diasAte } = carrega(codDias, ["diasAte"], `2026-09-29T${hora}:00-03:00`);
    assert.strictEqual(diasAte("2026-09-29"), 0, `no dia, as ${hora}`);
    assert.strictEqual(diasAte("2026-09-30"), 1, `vespera, as ${hora}`);
    assert.strictEqual(diasAte("2026-09-28"), -1, `dia seguinte, as ${hora}`);
  }
  const { diasAte } = carrega(codDias, ["diasAte"], "2026-09-29T10:00:00-03:00");
  assert.strictEqual(diasAte(null), null);
  assert.strictEqual(diasAte("lixo"), null);
});

/* simula o servidor aplicando as gravacoes que o gravaCADX gera */
const fv = { del: () => "DEL", union: l => ({ U: l }), remove: l => ({ R: l }), path: (...p) => p.join(".") };
function aplica(docu, ops) {
  docu = JSON.parse(JSON.stringify(docu));
  for (const o of ops) for (const c of (o.campos || Object.keys(o.dados))) {
    const p = c.split("."); let v = o.dados; for (const x of p) v = v[x];
    let alvo = docu; for (const x of p.slice(0, -1)) alvo = alvo[x] = alvo[x] || {};
    const u = p.at(-1), igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (v === "DEL") delete alvo[u];
    else if (v && v.U) { alvo[u] = alvo[u] || []; v.U.forEach(e => { if (!alvo[u].some(y => igual(y, e))) alvo[u].push(e); }); }
    else if (v && v.R) alvo[u] = (alvo[u] || []).filter(y => !v.R.some(e => igual(e, y)));
    else alvo[u] = v;
  }
  return docu;
}

test("difCADX: sem mudanca nao grava nada (nem por ordem de chaves)", () => {
  const { difCADX } = carrega(codDif, ["difCADX"]);
  const base = { extEdit: { "5": { loc: "A" } }, extAdd: [{ seq: 300, num: "1" }], extDel: [7] };
  assert.strictEqual(difCADX(base, JSON.parse(JSON.stringify(base)), fv).length, 0);
  assert.strictEqual(difCADX(base, { ...base, extAdd: [{ num: "1", seq: 300 }] }, fv).length, 0);
});

test("difCADX: dois admins mexendo ao mesmo tempo, nada se perde", () => {
  const { difCADX } = carrega(codDif, ["difCADX"]);
  const base = { extEdit: { "5": { loc: "A" } }, hidEdit: {}, extAdd: [{ seq: 300 }], extDel: [] };
  const local = JSON.parse(JSON.stringify(base));
  local.extAdd.push({ seq: 302 }); local.extEdit["5"] = { loc: "B" };
  const servidor = JSON.parse(JSON.stringify(base));
  servidor.extEdit["9"] = { loc: "X" }; servidor.extAdd.push({ seq: 301 });
  const r = aplica(servidor, difCADX(base, local, fv));
  assert.deepStrictEqual(r.extEdit, { "5": { loc: "B" }, "9": { loc: "X" } });
  assert.deepStrictEqual(r.extAdd.map(x => x.seq), [300, 301, 302]);
});

test("difCADX: remocao e inclusao na mesma lista vao em gravacoes separadas", () => {
  const { difCADX } = carrega(codDif, ["difCADX"]);
  const base = { extEdit: { "5": { loc: "A" } }, extAdd: [{ seq: 300, num: "1" }], extDel: [7] };
  const local = JSON.parse(JSON.stringify(base));
  delete local.extEdit["5"]; local.extDel = []; local.extAdd[0].num = "1b"; local.extReset = true;
  const ops = difCADX(base, local, fv);
  assert.strictEqual(ops.length, 3);
  assert.ok(ops.slice(1).every(o => o.campos === null), "listas vao com merge, nunca com mergeFields");
  assert.deepStrictEqual(aplica(base, ops), { extEdit: {}, extAdd: [{ seq: 300, num: "1b" }], extDel: [], extReset: true });
});
