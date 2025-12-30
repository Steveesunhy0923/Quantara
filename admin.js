(function(global){
  function getFunctions(){
    return firebase.app().functions('us-central1');
  }

  async function verifyAdminPassword(){
    try{
      const pwd = prompt('Admin password:');
      if(!pwd) return false;
      const callable = getFunctions().httpsCallable('verifyAdmin');
      await callable({ password: pwd });
      return true;
    }catch(e){ alert(e.message||e); return false; }
  }

  async function wikiCreate(data){
    const callable = getFunctions().httpsCallable('wikiCreate');
    const res = await callable({ data });
    return res && res.data || {};
  }

  async function wikiUpdate(id, data){
    const callable = getFunctions().httpsCallable('wikiUpdate');
    const res = await callable({ id, data });
    return res && res.data || {};
  }

  async function wikiDelete(id){
    const callable = getFunctions().httpsCallable('wikiDelete');
    const res = await callable({ id });
    return res && res.data || {};
  }

  global.AdminAPI = { verifyAdminPassword, wikiCreate, wikiUpdate, wikiDelete };
})(window);


