(function(){
    const db      = firebase.firestore();
    const feed    = document.getElementById('content');
    const listNav = document.getElementById('forum-list');
    let   current = '';              // '' = ALL

    /* (re)load posts */
    function loadFeed(){
        let ref = db.collection('communityPosts').orderBy('time','desc');
        if (current) ref = ref.where('discussion','==',current);
        ref.limit(50).get().then(function(qs){
            feed.innerHTML='';           // clear
            qs.forEach(doc => renderPost(doc)); // reuse existing helper from prior script
        });
    }

    /* click on a forum button */
    listNav.addEventListener('click',function(e){
        const btn = e.target.closest('button[data-forum]');
        if (!btn) return;
        current = btn.getAttribute('data-forum');          // '' or forum name
        [...listNav.children].forEach(b=>b.classList.toggle('active',b===btn));
        loadFeed();
    });

    /* + new post */
    document.getElementById('new-post-btn')
        .addEventListener('click',()=>location.href='new-post.html');

    /* first load = show all */
    loadFeed();
})();
