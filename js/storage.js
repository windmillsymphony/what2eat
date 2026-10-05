/* ============================================================
 * storage.js — 数据层：唯一 schema 定义处
 * 单 key 整库存 localStorage["what2eat_db"]，含版本迁移、导入导出
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  const KEY = 'what2eat_db';
  const VERSION = 1;

  // 未来版本迁移表：{ 2: fn(db), 3: fn(db), ... }
  const MIGRATIONS = {};

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 食材名规范化：trim + 全角转半角 + 去所有空格
  // 菜品食材 / 库存 / 过敏忌口 三处共用，是硬约束匹配能命中的前提
  function normalizeIngredient(s) {
    if (s == null) return '';
    s = String(s)
      .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ')
      .replace(/\s+/g, '')
      .trim();
    return s;
  }

  function defaultState() {
    const now = new Date().toISOString();
    return {
      version: VERSION,
      meta: { createdAt: now, updatedAt: now, onboarded: false, lastBatches: [] },
      dishes: [],
      inventory: [],
      preferences: {
        allergies: [],            // 过敏食材（硬约束）
        dislikedIngredients: [],  // 讨厌食材（硬约束）
        dislikedTags: [],         // 个人忌口标签（硬约束）
        maxSpicy: null,           // 个人辣度上限 1-5，null 不限制
        preferredSpicy: null,     // 口味偏好辣度 1-5，null 不参与打分
        defaultAvailableTimeMin: 60,
      },
      specialPeriods: [],
      pitfalls: [],
      history: [],
    };
  }

  function migrate(db) {
    while ((db.version || 1) < VERSION) {
      const fn = MIGRATIONS[db.version + 1];
      if (!fn) throw new Error('未知的数据版本：' + db.version);
      fn(db);
      db.version += 1;
    }
    return db;
  }

  let state = null;
  const subs = [];

  function load() {
    if (state) return state;
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      state = defaultState();
      persist();
      return state;
    }
    try {
      state = migrate(JSON.parse(raw));
    } catch (e) {
      console.error('数据加载失败，原数据已备份后重置', e);
      try { localStorage.setItem(KEY + '.corrupt.' + Date.now(), raw); } catch (e2) {}
      state = defaultState();
      persist();
    }
    return state;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('保存失败', e); }
  }

  function notify() {
    subs.forEach(function (fn) {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function save() {
    state.meta.updatedAt = new Date().toISOString();
    persist();
    notify();
  }

  // 执行一个变更函数，然后保存并通知订阅者
  function update(fn) {
    fn(state);
    save();
  }

  const nowISO = function () { return new Date().toISOString(); };

  /* ---------------- 菜品 ---------------- */

  function dishDefaults() {
    return {
      name: '', source: 'homemade', takeoutShop: '', category: '',
      tags: [], taste: { spicy: 0, salty: 0, sweet: 0, sour: 0, texture: '', temp: 'hot' },
      ingredients: [], cookTimeMin: 0, rating: 0, loved: false,
      banned: false, banReason: '', notes: '', status: 'active',
      createdAt: nowISO(), updatedAt: nowISO(),
    };
  }

  function addDish(data) {
    const id = uid('d');
    update(function (s) {
      s.dishes.push(Object.assign(dishDefaults(), data, { id: id, createdAt: nowISO(), updatedAt: nowISO() }));
    });
    return id;
  }

  function updateDish(id, patch) {
    update(function (s) {
      const d = s.dishes.find(function (x) { return x.id === id; });
      if (d) Object.assign(d, patch, { updatedAt: nowISO() });
    });
  }

  function deleteDish(id) {
    update(function (s) {
      s.dishes = s.dishes.filter(function (d) { return d.id !== id; });
    });
  }

  /* ---------------- 库存 ---------------- */

  function addInventoryItem(data) {
    const id = uid('i');
    update(function (s) {
      s.inventory.push({
        id: id, name: normalizeIngredient(data.name), qty: data.qty || '',
        unit: data.unit || '', category: data.category || '其他', addedAt: nowISO(),
      });
    });
    return id;
  }

  function updateInventoryItem(id, patch) {
    update(function (s) {
      const it = s.inventory.find(function (x) { return x.id === id; });
      if (it) Object.assign(it, patch);
    });
  }

  function deleteInventoryItem(id) {
    update(function (s) {
      s.inventory = s.inventory.filter(function (x) { return x.id !== id; });
    });
  }

  // 吃掉食材后扣减：数量可解析为数字且 >1 则减 1，否则整条移除
  function consumeInventory(names) {
    update(function (s) {
      (names || []).forEach(function (name) {
        const it = s.inventory.find(function (x) { return x.name === name; });
        if (!it) return;
        const m = /^(\d+)/.exec(it.qty || '');
        if (m && parseInt(m[1], 10) > 1) {
          it.qty = it.qty.replace(m[1], String(parseInt(m[1], 10) - 1));
        } else {
          s.inventory = s.inventory.filter(function (x) { return x !== it; });
        }
      });
    });
  }

  /* ---------------- 偏好 ---------------- */

  function savePreferences(patch) {
    update(function (s) {
      Object.assign(s.preferences, patch);
    });
  }

  /* ---------------- 特殊时期 ---------------- */

  function addPeriod(data) {
    const id = uid('sp');
    update(function (s) {
      s.specialPeriods.push(Object.assign({
        id: id, templateId: 'custom', name: '自定义', enabled: true,
        startedAt: nowISO(), endedAt: null, suggestedDays: null,
        rules: {
          forbidIngredients: [], forbidTags: [], forbidDishes: [], forbidShops: [],
          maxSpicy: null, preferTags: [], requireCooked: false,
        },
        notes: '',
      }, data, { id: id }));
    });
    return id;
  }

  function updatePeriod(id, patch) {
    update(function (s) {
      const p = s.specialPeriods.find(function (x) { return x.id === id; });
      if (p) Object.assign(p, patch);
    });
  }

  function endPeriod(id) {
    updatePeriod(id, { enabled: false, endedAt: nowISO() });
  }

  function deletePeriod(id) {
    update(function (s) {
      s.specialPeriods = s.specialPeriods.filter(function (x) { return x.id !== id; });
    });
  }

  /* ---------------- 踩雷记录 ---------------- */

  function addPitfall(data) {
    const id = uid('p');
    update(function (s) {
      s.pitfalls.push(Object.assign({
        id: id, shop: '', dishName: '', dishId: null, problem: '',
        severity: 'soft', createdAt: nowISO(),
      }, data, { id: id }));
    });
    return id;
  }

  function deletePitfall(id) {
    update(function (s) {
      s.pitfalls = s.pitfalls.filter(function (x) { return x.id !== id; });
    });
  }

  /* ---------------- 用餐历史 ---------------- */

  function addHistory(data) {
    const id = uid('h');
    update(function (s) {
      s.history.push(Object.assign({
        id: id, dishId: null, dishName: '', source: 'homemade',
        eatenAt: nowISO(), wasRecommended: false,
        feedback: { rating: 0, bodyIssues: [], notes: '' },
      }, data, { id: id }));
    });
    return id;
  }

  function deleteHistory(id) {
    update(function (s) {
      s.history = s.history.filter(function (x) { return x.id !== id; });
    });
  }

  /* ---------------- meta ---------------- */

  // 记录最近一批推荐（换一批去重用，只留最近两批）
  function recordBatch(ids) {
    update(function (s) {
      s.meta.lastBatches = (s.meta.lastBatches || []).concat([ids.slice()]).slice(-2);
    });
  }

  function setOnboarded() {
    update(function (s) { s.meta.onboarded = true; });
  }

  /* ---------------- 演示数据 ---------------- */

  function seedDemoData() {
    const now = Date.now();
    const ago = function (days) { return new Date(now - days * 86400000).toISOString(); };
    const hoursAgo = function (h) { return new Date(now - h * 3600000).toISOString(); };

    const dishes = [
      { name: '番茄鸡蛋面', source: 'homemade', category: '面食', tags: ['清淡', '热乎', '快手'],
        taste: { spicy: 0, salty: 1, sweet: 0, sour: 1, texture: '筋道', temp: 'hot' },
        ingredients: ['西红柿', '鸡蛋', '面条'], cookTimeMin: 15, rating: 5, loved: true },
      { name: '番茄炒蛋', source: 'homemade', category: '家常菜', tags: ['清淡', '下饭', '快手'],
        taste: { spicy: 0, salty: 2, sweet: 1, sour: 2, texture: '嫩滑', temp: 'hot' },
        ingredients: ['西红柿', '鸡蛋'], cookTimeMin: 10, rating: 4, loved: true },
      { name: '麻辣烫', source: 'takeout', takeoutShop: '杨国福麻辣烫', category: '快餐', tags: ['辛辣', '油腻'],
        taste: { spicy: 4, salty: 4, sweet: 0, sour: 0, texture: '', temp: 'hot' },
        ingredients: [], cookTimeMin: 0, rating: 4, loved: false },
      { name: '黄焖鸡米饭', source: 'takeout', takeoutShop: '黄焖鸡米饭店', category: '米饭', tags: ['下饭', '热乎'],
        taste: { spicy: 1, salty: 3, sweet: 0, sour: 0, texture: '', temp: 'hot' },
        ingredients: [], cookTimeMin: 0, rating: 4, loved: false },
      { name: '兰州拉面', source: 'takeout', takeoutShop: '兰州拉面馆', category: '面食', tags: ['热乎'],
        taste: { spicy: 0, salty: 3, sweet: 0, sour: 0, texture: '', temp: 'hot' },
        ingredients: [], cookTimeMin: 0, rating: 3, loved: false },
      { name: '凉皮', source: 'takeout', takeoutShop: '魏家凉皮', category: '小吃', tags: ['生冷'],
        taste: { spicy: 0, salty: 2, sweet: 0, sour: 1, texture: '脆爽', temp: 'cold' },
        ingredients: [], cookTimeMin: 0, rating: 3, loved: false },
      { name: '炸鸡汉堡', source: 'takeout', takeoutShop: '麦当劳', category: '快餐', tags: ['油炸'],
        taste: { spicy: 0, salty: 3, sweet: 0, sour: 0, texture: '酥脆', temp: 'hot' },
        ingredients: [], cookTimeMin: 0, rating: 4, loved: true },
      { name: '蛋炒饭', source: 'homemade', category: '米饭', tags: ['快手', '下饭'],
        taste: { spicy: 0, salty: 3, sweet: 0, sour: 0, texture: '适中', temp: 'hot' },
        ingredients: ['米饭', '鸡蛋', '火腿肠'], cookTimeMin: 10, rating: 4, loved: false },
      { name: '皮蛋瘦肉粥', source: 'homemade', category: '汤粥', tags: ['清淡', '粥类', '易消化'],
        taste: { spicy: 0, salty: 1, sweet: 0, sour: 0, texture: '软烂', temp: 'hot' },
        ingredients: ['大米', '皮蛋', '猪肉'], cookTimeMin: 40, rating: 4, loved: true },
      { name: '宫保鸡丁', source: 'homemade', category: '家常菜', tags: ['下饭'],
        taste: { spicy: 2, salty: 3, sweet: 1, sour: 1, texture: '嫩滑', temp: 'hot' },
        ingredients: ['鸡胸肉', '花生', '黄瓜'], cookTimeMin: 25, rating: 4, loved: false },
    ];

    const inventory = [
      { name: '西红柿', qty: '2', unit: '个', category: '蔬菜' },
      { name: '鸡蛋', qty: '6', unit: '个', category: '肉蛋' },
      { name: '面条', qty: '1', unit: '袋', category: '主食' },
      { name: '大米', qty: '1', unit: '袋', category: '主食' },
      { name: '黄瓜', qty: '2', unit: '根', category: '蔬菜' },
      { name: '鸡胸肉', qty: '1', unit: '块', category: '肉蛋' },
    ];

    state = defaultState();
    state.meta.onboarded = true;

    const dishIds = {};
    state.dishes = dishes.map(function (d, i) {
      const id = 'demo_d' + i;
      dishIds[d.name] = id;
      return Object.assign(dishDefaults(), d, { id: id, createdAt: ago(30 + i) });
    });

    state.inventory = inventory.map(function (it, i) {
      return { id: 'demo_i' + i, name: it.name, qty: it.qty, unit: it.unit, category: it.category, addedAt: ago(10) };
    });

    state.history = [
      { id: 'demo_h1', dishId: dishIds['番茄鸡蛋面'], dishName: '番茄鸡蛋面', source: 'homemade',
        eatenAt: hoursAgo(23), wasRecommended: true, feedback: { rating: 5, bodyIssues: ['无不适'], notes: '' } },
      { id: 'demo_h2', dishId: dishIds['麻辣烫'], dishName: '麻辣烫', source: 'takeout',
        eatenAt: ago(2), wasRecommended: true, feedback: { rating: 4, bodyIssues: ['上火'], notes: '吃完喉咙有点干' } },
      { id: 'demo_h3', dishId: dishIds['炸鸡汉堡'], dishName: '炸鸡汉堡', source: 'takeout',
        eatenAt: ago(5), wasRecommended: false, feedback: { rating: 4, bodyIssues: ['无不适'], notes: '' } },
    ];

    state.specialPeriods = [{
      id: 'demo_sp1', templateId: 'menstrual', name: '月经期', enabled: false,
      startedAt: ago(8), endedAt: ago(3), suggestedDays: 7,
      rules: { forbidIngredients: [], forbidTags: ['生冷', '冰饮'], forbidDishes: [], forbidShops: [], maxSpicy: null, preferTags: ['热乎', '汤类'], requireCooked: false },
      notes: '避免生冷，注意保暖',
    }];

    state.pitfalls = [{
      id: 'demo_p1', shop: '魏家凉皮', dishName: '凉皮', dishId: dishIds['凉皮'],
      problem: '太咸，花生不新鲜', severity: 'soft', createdAt: ago(4),
    }];

    save();
  }

  /* ---------------- 导出 / 导入 / 清空 ---------------- */

  function exportData() {
    return JSON.stringify(state, null, 2);
  }

  function importData(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { ok: false, error: '不是有效的 JSON 文件' }; }
    if (!obj || typeof obj !== 'object' ||
        !Array.isArray(obj.dishes) || !Array.isArray(obj.inventory) || !Array.isArray(obj.history)) {
      return { ok: false, error: '数据结构不对，不是本应用的备份文件' };
    }
    try {
      obj.version = obj.version || 1;
      obj = migrate(obj);
    } catch (e) {
      return { ok: false, error: '备份版本无法识别：' + e.message };
    }
    obj.meta = obj.meta || { onboarded: false, lastBatches: [] };
    obj.preferences = Object.assign(defaultState().preferences, obj.preferences || {});
    obj.specialPeriods = obj.specialPeriods || [];
    obj.pitfalls = obj.pitfalls || [];
    obj.meta.updatedAt = nowISO();
    state = obj;
    persist();
    notify();
    return { ok: true };
  }

  function clearAll() {
    localStorage.removeItem(KEY);
    state = defaultState();
    persist();
    notify();
  }

  W2E.db = {
    KEY: KEY,
    getState: load,
    save: save,
    update: update,
    subscribe: function (fn) { subs.push(fn); },
    uid: uid,
    normalizeIngredient: normalizeIngredient,
    // 菜品
    addDish: addDish,
    updateDish: updateDish,
    deleteDish: deleteDish,
    // 库存
    addInventoryItem: addInventoryItem,
    updateInventoryItem: updateInventoryItem,
    deleteInventoryItem: deleteInventoryItem,
    consumeInventory: consumeInventory,
    // 偏好
    savePreferences: savePreferences,
    // 特殊时期
    addPeriod: addPeriod,
    updatePeriod: updatePeriod,
    endPeriod: endPeriod,
    deletePeriod: deletePeriod,
    // 踩雷
    addPitfall: addPitfall,
    deletePitfall: deletePitfall,
    // 历史
    addHistory: addHistory,
    deleteHistory: deleteHistory,
    // meta 与其他
    recordBatch: recordBatch,
    setOnboarded: setOnboarded,
    seedDemoData: seedDemoData,
    exportData: exportData,
    importData: importData,
    clearAll: clearAll,
  };
})();
