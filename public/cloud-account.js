(() => {
  if (window.Capacitor?.isNativePlatform?.()) return;

  const state = { user: null, dirty: false, timer: null, syncing: false, online: true, revision: 0 };
  const $ = id => document.getElementById(id);
  const accountMarker = 'single-point-word-learning.cloud-account.v1';
  const learningKeys = ['single-point-word-learning.article.v1','single-point-word-learning.wordbook.v1','single-point-word-learning.article-archive.v1'];

  function makeUi() {
    const auth = document.createElement('div');
    auth.id = 'cloudAuth';
    auth.innerHTML = `<form class="cloud-box" id="cloudAuthForm">
      <h2>进入你的学习档案</h2><p>每个人拥有独立的文章、单词本和学习进度。</p>
      <div class="cloud-tabs"><button type="button" class="active" data-auth-mode="login">登录</button><button type="button" data-auth-mode="register">用邀请码注册</button></div>
      <label for="cloudUsername">用户名</label><input id="cloudUsername" autocomplete="username" maxlength="24" required>
      <label for="cloudPassword">密码</label><input id="cloudPassword" type="password" autocomplete="current-password" maxlength="128" required>
      <div id="cloudInviteRow" hidden><label for="cloudInvite">邀请码</label><input id="cloudInvite" autocomplete="off" maxlength="80"></div>
      <p class="cloud-error" id="cloudAuthError" role="alert"></p>
      <button class="cloud-submit" id="cloudAuthSubmit">登录并继续</button>
      <div class="cloud-privacy">你的学习档案会加密传输并保存在这台服务器。调用 AI 时，必要的原文会发送给 DeepSeek；API Key 仅保存在当前标签页，不进入云档案。</div>
    </form>`;
    document.body.append(auth);

    const account = document.createElement('div');
    account.id = 'cloudAccount';
    account.innerHTML = `<div class="cloud-box"><h2 id="cloudAccountName">学习账户</h2><p>云档案让手机、平板和电脑继续同一份进度。</p><div class="cloud-sync-state" id="cloudSyncState">正在检查同步状态…</div><div class="cloud-account-actions"><button id="cloudSyncNow">立即同步</button><button id="cloudLogout" class="secondary">退出此账户</button><button id="cloudAccountClose" class="secondary">关闭</button></div></div>`;
    document.body.append(account);

    const accountButton = document.createElement('button');
    accountButton.id = 'cloudAccountButton';
    accountButton.className = 'secondary key-button cloud-user';
    accountButton.textContent = '账户';
    document.querySelector('.header-right')?.append(accountButton);

    let mode = 'login';
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.onclick = () => {
      mode = button.dataset.authMode;
      document.querySelectorAll('[data-auth-mode]').forEach(item => item.classList.toggle('active', item === button));
      $('cloudInviteRow').hidden = mode !== 'register';
      $('cloudPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      $('cloudAuthSubmit').textContent = mode === 'register' ? '注册并开始使用' : '登录并继续';
      $('cloudAuthError').textContent = '';
    });

    $('cloudAuthForm').onsubmit = async event => {
      event.preventDefault();
      const submit = $('cloudAuthSubmit');submit.disabled = true;$('cloudAuthError').textContent = '';
      try {
        const response = await fetch(`/api/auth/${mode}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('cloudUsername').value.trim(),password:$('cloudPassword').value,inviteCode:$('cloudInvite').value.trim()})});
        const payload = await response.json();if(!response.ok)throw new Error(payload.error||'暂时无法登录');
        location.reload();
      } catch(error) { $('cloudAuthError').textContent = error.message;submit.disabled = false; }
    };
    accountButton.onclick = () => { if (!state.user) return showAuth(); $('cloudAccountName').textContent = `${state.user.username} 的学习账户`; updateSyncLabel();account.style.display='flex'; };
    $('cloudAccountClose').onclick = () => account.style.display='none';
    $('cloudSyncNow').onclick = () => syncToCloud(true);
    $('cloudLogout').onclick = async () => { await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});location.reload(); };
  }

  function showAuth() { $('cloudAuth').style.display='flex';document.body.classList.add('cloud-locked');setTimeout(()=>$('cloudUsername').focus(),0); }
  function hideAuth() { $('cloudAuth').style.display='none';document.body.classList.remove('cloud-locked'); }
  function updateSyncLabel(message) {
    const text = message || (state.syncing?'正在同步…':state.dirty?'有更改等待同步':state.online?'云档案已同步':'离线使用本机档案');
    if ($('cloudSyncState')) $('cloudSyncState').textContent=text;
    if ($('cloudAccountButton')) {$('cloudAccountButton').textContent=state.user?`${state.user.username}${state.dirty?' · 未同步':''}`:'账户';$('cloudAccountButton').title=text;}
  }

  function waitForLearning() {
    return new Promise(resolve => {
      const check=()=>typeof window.backupPayload==='function'&&typeof window.mergeBackup==='function'?resolve():setTimeout(check,50);check();
    });
  }

  async function request(path, options) {
    const response=await fetch(path,options);let payload={};try{payload=await response.json()}catch{}
    if(response.status===401){state.user=null;showAuth();throw new Error('登录已经失效，请重新登录。')}
    if(!response.ok)throw new Error(payload.error||'云端暂时无法处理');return payload;
  }

  async function initialSync() {
    if(!state.user)return;await waitForLearning();
    try {
      const remote=await request('/api/sync',{cache:'no-store'});
      if(remote.snapshot) window.mergeBackup(remote.snapshot);
      state.online=true;state.dirty=true;await syncToCloud(true);
    } catch(error) { state.online=false;updateSyncLabel(`暂未同步：${error.message}`); }
  }

  async function syncToCloud(force=false) {
    if(!state.user||state.syncing||(!state.dirty&&!force)||typeof window.backupPayload!=='function')return;
    state.syncing=true;const revision=state.revision;updateSyncLabel();
    try {
      const snapshot=window.backupPayload();
      await request('/api/sync',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot})});
      state.dirty=state.revision!==revision;state.online=true;updateSyncLabel(state.dirty?'新改动等待同步':'刚刚已同步');
    } catch(error) { state.online=false;state.dirty=true;updateSyncLabel(`同步失败：${error.message}`); }
    finally { state.syncing=false;if(state.dirty){clearTimeout(state.timer);state.timer=setTimeout(()=>syncToCloud(),1800)} }
  }

  window.scheduleCloudSync = () => {
    if(!state.user)return;state.revision++;state.dirty=true;updateSyncLabel();clearTimeout(state.timer);state.timer=setTimeout(()=>syncToCloud(),1800);
  };
  window.cloudSyncNow = () => syncToCloud(true);
  window.addEventListener('online',()=>{state.online=true;syncToCloud(true)});
  window.addEventListener('offline',()=>{state.online=false;updateSyncLabel()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')syncToCloud()});

  makeUi();
  fetch('/api/auth/status',{cache:'no-store'}).then(async response=>{
    const payload=await response.json();
    if(!payload.authenticated){showAuth();return}
    const previous=localStorage.getItem(accountMarker),current=payload.user.username.toLowerCase();
    if(previous&&previous!==current){learningKeys.forEach(key=>localStorage.removeItem(key));localStorage.setItem(accountMarker,current);location.reload();return}
    if(!previous)localStorage.setItem(accountMarker,current);
    state.user=payload.user;hideAuth();updateSyncLabel();
    if(document.readyState==='complete')initialSync();else window.addEventListener('load',initialSync,{once:true});
  }).catch(()=>{state.online=false;hideAuth();updateSyncLabel('离线使用本机档案')});
})();
