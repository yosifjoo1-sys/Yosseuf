// دفتر حسابات: كل الحسابات بالكود (مش بالذكاء الاصطناعي) عشان الأرقام تبقى دقيقة.
import { loadJSON, saveJSON } from "./store.js";

const FILE = "ledger.json";
const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => Math.round(c) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function all() { return loadJSON(FILE, { seq: 0, tx: [] }); }

export function addTransaction(owner, { type, amount, category = "عام", note = "", date, currency = "EGP" }) {
  if (!["income", "expense"].includes(type)) throw new Error("النوع لازم يكون income أو expense");
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) throw new Error("المبلغ لازم يكون رقم أكبر من صفر");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("التاريخ بصيغة YYYY-MM-DD");
  const db = all();
  const t = { id: ++db.seq, owner, type, amount: fromCents(toCents(a)), category, note, date: date || today(), currency };
  db.tx.push(t);
  saveJSON(FILE, db);
  return t;
}

export function listTransactions(owner, { from, to, limit = 30 } = {}) {
  return all().tx
    .filter((t) => t.owner === owner && (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => (a.date < b.date ? 1 : -1) || b.id - a.id)
    .slice(0, limit);
}

export function deleteTransaction(owner, id) {
  const db = all();
  const i = db.tx.findIndex((t) => t.id === Number(id) && t.owner === owner);
  if (i < 0) throw new Error("العملية مش موجودة");
  const [t] = db.tx.splice(i, 1);
  saveJSON(FILE, db);
  return t;
}

export function report(owner, { from, to } = {}) {
  const rows = all().tx.filter((t) => t.owner === owner && (!from || t.date >= from) && (!to || t.date <= to));
  let inc = 0, exp = 0;
  const cat = {};
  for (const t of rows) {
    const c = toCents(t.amount);
    if (t.type === "income") inc += c; else exp += c;
    cat[t.category] ??= { income: 0, expense: 0 };
    cat[t.category][t.type] += c;
  }
  const net = inc - exp;
  return {
    from: from || null, to: to || null, count: rows.length,
    total_income: fromCents(inc), total_expense: fromCents(exp), net_profit: fromCents(net),
    profit_margin_pct: inc ? Math.round((net / inc) * 10000) / 100 : null,
    by_category: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, {
      income: fromCents(v.income), expense: fromCents(v.expense), net: fromCents(v.income - v.expense),
    }])),
  };
}
