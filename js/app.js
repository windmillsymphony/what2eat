/* ============================================================
 * app.js — 入口：hash 路由、Tab 高亮、数据变更订阅
 * ============================================================ */
window.W2E = window.W2E || {};

(function () {
  'use strict';

  const views = W2E.views;

  const ROUTES = [
    { key: '/dish/new', view: function (c) { views.dishForm(c, null); }, meta: { title: '新增菜品', tab: 'dishes', back: '/dishes' } },
    { key: '/dish/:id/edit', view: function (c, p) { views.dishForm(c, p.id); }, meta: { title: '编辑菜品', tab: 'dishes', back: '/dish/:id' } },
    { key: '/dish/:id', view: function (c, p) { views.dishDetail(c, p.id); }, meta: { title: '菜品详情', tab: 'dishes', back: '/dishes' } },
    { key: '/quickadd', view: function (c) { views.quickadd(c); }, meta: { title: '快捷添加菜品', tab: 'dishes', back: '/home' } },
    { key: '/home', view: function (c) { views.home(c); }, meta: { title: '今天吃什么', tab: 'home' } },
    { key: '/dishes', view: function (c) { views.dishes(c); }, meta: { title: '菜品', tab: 'dishes' } },
    { key: '/inventory', view: function (c) { views.inventory(c); }, meta: { title: '食材库存', tab: 'inventory' } },
    { key: '/periods', view: function (c) { views.periods(c); }, meta: { title: '特殊时期', tab: 'periods' } },
    { key: '/settings', view: function (c) { views.settings(c); }, meta: { title: '我的', tab: 'settings' } },
    { key: '/preferences', view: function (c) { views.preferences(c); }, meta: { title: '偏好与忌口', tab: 'settings', back: '/settings' } },
    { key: '/history', view: function (c) { views.historyView(c); }, meta: { title: '用餐历史', tab: 'settings', back: '/settings' } },
    { key: '/pitfalls', view: function (c) { views.pitfalls(c); }, meta: { title: '踩雷记录', tab: 'settings', back: '/settings' } },
    { key: '/data', view: function (c) { views.dataPage(c); }, meta: { title: '数据备份', tab: 'settings', back: '/settings' } },
  ];

  // 数据变化时自动重渲染这些页面；表单/偏好页自行管理，避免输入被打断
  const RERENDER = { '/home': 1, '/dishes': 1, '/inventory': 1, '/periods': 1, '/history': 1, '/pitfalls': 1, '/data': 1, '/dish/:id': 1, '/settings': 1 };

  let current = { key: '/home', params: null, route: ROUTES[4] };
  let lastKey = null;

  function parseRoute() {
    let path = (location.hash || '').replace(/^#/, '');
    if (!path || path === '/') path = '/home';
    const parts = path.split('/'); // ['', 'dish', 'id', 'edit']
    for (let ri = 0; ri < ROUTES.length; ri++) {
      const r = ROUTES[ri];
      const kp = r.key.split('/');
      if (kp.length !== parts.length) continue;
      let params = null;
      let ok = true;
      for (let i = 0; i < kp.length; i++) {
        if (kp[i].charAt(0) === ':') {
          params = params || {};
          params[kp[i].slice(1)] = parts[i];
        } else if (kp[i] !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { key: r.key, params: params, route: r };
    }
    return { key: '/home', params: null, route: ROUTES[4] };
  }

  function render() {
    const r = parseRoute();
    const routeChanged = lastKey !== r.key;
    lastKey = r.key;
    current = r;

    document.getElementById('pageTitle').textContent = r.route.meta.title;
    const backBtn = document.getElementById('backBtn');
    if (r.route.meta.back) {
      backBtn.hidden = false;
      backBtn.onclick = function () {
        let target = r.route.meta.back;
        if (r.params) {
          for (const k in r.params) target = target.replace(':' + k, r.params[k]);
        }
        location.hash = '#' + target;
      };
    } else {
      backBtn.hidden = true;
    }
    document.querySelectorAll('#tabbar a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.tab === r.route.meta.tab);
    });

    const c = document.getElementById('view');
    c.innerHTML = '';
    r.route.view(c, r.params);
    if (routeChanged) window.scrollTo(0, 0);
  }

  W2E.app = { render: render };

  // 数据变更 → 当前页自动刷新（模态框在 #modal-root，不受影响）
  W2E.db.subscribe(function () {
    if (current.key in RERENDER) render();
  });

  window.addEventListener('hashchange', render);

  // 启动
  W2E.db.getState();
  if (!location.hash) location.hash = '#/home';
  render();

  // PWA：立即注册 Service Worker（file:// 下不可用，自动跳过）
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('Service Worker 注册失败（本地预览可忽略）', err);
    });
  }
})();
