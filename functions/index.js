const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

// -----------------------------
// Daily Challenge (problem-of-the-day)
// -----------------------------

function todayKeyNY(){
  // YYYY-MM-DD in America/New_York
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p=>p.type==='year')?.value;
  const m = parts.find(p=>p.type==='month')?.value;
  const d = parts.find(p=>p.type==='day')?.value;
  return `${y}-${m}-${d}`;
}

function assertDateKey(dateKey){
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)){
    throw new functions.https.HttpsError('invalid-argument', 'dateKey must be YYYY-MM-DD');
  }
  return dateKey;
}

function tzOffsetMinutesAtInstant(timeZone, date){
  // Returns offset minutes such that: local = utc + offset
  // Uses Intl shortOffset like "GMT-5" or "GMT-04:00"
  const tzPart = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find(p=>p.type==='timeZoneName')?.value || 'GMT+0';
  const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = Number(m[2] || 0);
  const mm = Number(m[3] || 0);
  return sign * (hh * 60 + mm);
}

function nyLocalToTimestamp(dateKey, hour, minute, second, ms){
  const [y, mo, d] = dateKey.split('-').map(Number);
  const baseUtc = Date.UTC(y, mo - 1, d, hour, minute, second, ms);

  // Iterate a couple times to resolve DST offset correctly.
  let utcMillis = baseUtc;
  for (let i = 0; i < 2; i++){
    const offMin = tzOffsetMinutesAtInstant('America/New_York', new Date(utcMillis));
    utcMillis = baseUtc - offMin * 60 * 1000;
  }
  return admin.firestore.Timestamp.fromMillis(utcMillis);
}

function normalizeAnswer(s){
  return String(s || '').trim().toLowerCase();
}

function addDaysDateKey(dateKey, deltaDays){
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getChallengeKey(){
  const keyB64 = process.env.CHALLENGE_ANSWER_KEY || functions.config().challenge?.answer_key;
  if (!keyB64){
    throw new functions.https.HttpsError('failed-precondition', 'Challenge key not configured');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32){
    throw new functions.https.HttpsError('failed-precondition', 'Challenge key must be 32 bytes (base64)');
  }
  return key;
}

function encryptAnswer(answerPlain){
  const key = getChallengeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(answerPlain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    answerCiphertext: ct.toString('base64'),
    answerIv: iv.toString('base64'),
    answerTag: tag.toString('base64'),
  };
}

function decryptAnswer({ answerCiphertext, answerIv, answerTag }){
  const key = getChallengeKey();
  const iv = Buffer.from(String(answerIv), 'base64');
  const tag = Buffer.from(String(answerTag), 'base64');
  const ct = Buffer.from(String(answerCiphertext), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function encryptConcepts(concepts){
  const key = getChallengeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(concepts || []);
  const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    conceptsCiphertext: ct.toString('base64'),
    conceptsIv: iv.toString('base64'),
    conceptsTag: tag.toString('base64'),
  };
}

function decryptConcepts({ conceptsCiphertext, conceptsIv, conceptsTag }){
  if (!conceptsCiphertext || !conceptsIv || !conceptsTag) return [];
  const key = getChallengeKey();
  const iv = Buffer.from(String(conceptsIv), 'base64');
  const tag = Buffer.from(String(conceptsTag), 'base64');
  const ct = Buffer.from(String(conceptsCiphertext), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  try{
    const parsed = JSON.parse(pt.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}

async function getUserProfile(uid){
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists ? (snap.data() || {}) : {};
}

function requireAuth(context){
  if (!context.auth){
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  return context.auth;
}

function requireAdminClaim(context){
  const auth = requireAuth(context)
  if (!auth?.token?.admin){
    throw new functions.https.HttpsError('permission-denied', 'Admin required')
  }
  return auth
}

function requireSteveUploader(username, context){
  const isAdmin = !!context.auth?.token?.admin;
  if (username !== 'stevesunhy' || !isAdmin){
    throw new functions.https.HttpsError('permission-denied', 'Not allowed to publish challenges');
  }
}

async function requireSteveAdmin(context){
  const auth = requireAdminClaim(context)
  const prof = await getUserProfile(auth.uid)
  const username = prof.username || ''
  if (username !== 'stevesunhy'){
    throw new functions.https.HttpsError('permission-denied', 'Only stevesunhy can perform this action')
  }
  return { auth, username }
}

async function ensureSystemChatWith(targetUid){
  const cid = `sys_${String(targetUid)}`
  const ref = db.doc(`chats/${cid}`)
  const snap = await ref.get()
  if (!snap.exists){
    await ref.set({
      kind: 'system',
      title: 'Quantara Team',
      participants: ['system', String(targetUid)],
      createdAt: FieldValue.serverTimestamp(),
      lastMessage: '',
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadCounts: {},
      lastReadAt: {},
    }, { merge: false })
  }
  return cid
}

async function sendSystemDm(targetUid, text){
  const cid = await ensureSystemChatWith(targetUid)
  await db.collection('chats').doc(cid).collection('messages').add({
    kind: 'text',
    senderUid: 'system',
    text: `Quantara Team: ${String(text || '').slice(0, 4000)}`,
    createdAt: FieldValue.serverTimestamp(),
    system: true,
  })
}

async function deleteCommentsForPost(postId){
  const col = db.collection('comments')
  let last = null
  for (let i = 0; i < 20; i++){ // safety cap
    let q = col.where('postId', '==', postId).orderBy(admin.firestore.FieldPath.documentId()).limit(400)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    const batch = db.batch()
    for (const d of snap.docs){
      batch.delete(d.ref)
    }
    await batch.commit()
    last = snap.docs[snap.docs.length - 1]
  }
}

// -----------------------------
// Users: usernames + profile helpers
// -----------------------------

function normalizeUsernameCandidate(input){
  // Keep in sync with web constraint: /^[a-z0-9._-]{3,32}$/
  let s = String(input || '').trim().toLowerCase()
  if (!s) return null
  // Convert whitespace to underscores; remove unsupported chars.
  s = s.replace(/\s+/g, '_')
  s = s.replace(/[^a-z0-9._-]/g, '')
  // Collapse underscores.
  s = s.replace(/_+/g, '_')
  // Trim non-alnum edges so we don't end up with "___" / ".." etc.
  s = s.replace(/^[._-]+/, '').replace(/[._-]+$/, '')
  if (!s) return null
  if (s.length > 32) s = s.slice(0, 32)
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) return null
  return s
}

function randomDigits(count){
  const n = clampInt(count, 1, 12)
  let out = ''
  for (let i = 0; i < n; i++){
    out += String(Math.floor(Math.random() * 10))
  }
  return out
}

function truncateToLen(s, maxLen){
  const str = String(s || '')
  const m = clampInt(maxLen, 0, 10_000)
  return str.length <= m ? str : str.slice(0, m)
}

async function reserveUniqueUsernameTx(tx, uid, preferredBase){
  const base =
    normalizeUsernameCandidate(preferredBase)
    || 'user'

  // Try a few candidates; first attempt is the base as-is, then base_######.
  for (let i = 0; i < 40; i++){
    const suffix = (i === 0) ? '' : `_${randomDigits(6)}`
    const candidate = truncateToLen(base, 32 - suffix.length) + suffix
    const unameRef = db.doc(`usernames/${candidate}`)
    const unameSnap = await tx.get(unameRef)
    if (!unameSnap.exists){
      tx.set(unameRef, { uid: String(uid), createdAt: FieldValue.serverTimestamp() }, { merge: false })
      return candidate
    }
  }

  // Absolute fallback: user_<uidPrefix>
  const fallback = `user_${String(uid || '').slice(0, 8).toLowerCase()}`
  const f = normalizeUsernameCandidate(fallback) || 'user_000000'
  const unameRef = db.doc(`usernames/${f}`)
  const unameSnap = await tx.get(unameRef)
  if (!unameSnap.exists){
    tx.set(unameRef, { uid: String(uid), createdAt: FieldValue.serverTimestamp() }, { merge: false })
    return f
  }
  throw new functions.https.HttpsError('resource-exhausted', 'Failed to allocate a unique username')
}

async function updateAuthorFieldsForUser(uid, patch){
  const authorUid = String(uid || '')
  if (!authorUid) return { postsUpdated: 0, commentsUpdated: 0 }
  const updates = patch && typeof patch === 'object' ? patch : {}

  let postsUpdated = 0
  let commentsUpdated = 0

  // communityPosts
  {
    const col = db.collection('communityPosts')
    let last = null
    for (let i = 0; i < 50; i++){
      let q = col.where('author', '==', authorUid).orderBy(admin.firestore.FieldPath.documentId()).limit(400)
      if (last) q = q.startAfter(last)
      const snap = await q.get()
      if (snap.empty) break
      const batch = db.batch()
      for (const d of snap.docs){
        batch.set(d.ref, updates, { merge: true })
        postsUpdated++
      }
      await batch.commit()
      last = snap.docs[snap.docs.length - 1]
    }
  }

  // comments
  {
    const col = db.collection('comments')
    let last = null
    for (let i = 0; i < 50; i++){
      let q = col.where('author', '==', authorUid).orderBy(admin.firestore.FieldPath.documentId()).limit(400)
      if (last) q = q.startAfter(last)
      const snap = await q.get()
      if (snap.empty) break
      const batch = db.batch()
      for (const d of snap.docs){
        batch.set(d.ref, updates, { merge: true })
        commentsUpdated++
      }
      await batch.commit()
      last = snap.docs[snap.docs.length - 1]
    }
  }

  return { postsUpdated, commentsUpdated }
}

// Ensure the user has a profile doc and a reserved username.
// Called by the client right after Google sign-in.
exports.userEnsureProfile = functions.https.onCall(async (_data, context) => {
  const auth = requireAuth(context)
  const uid = String(auth.uid || '')
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Missing uid')

  const userRecord = await admin.auth().getUser(uid)
  const displayName = String(userRecord.displayName || '')
  const photoURL = userRecord.photoURL ? String(userRecord.photoURL) : null
  const email = userRecord.email ? String(userRecord.email) : null

  const userRef = db.doc(`users/${uid}`)
  const out = await db.runTransaction(async (tx)=>{
    const snap = await tx.get(userRef)
    const existing = snap.exists ? (snap.data() || {}) : {}
    let usernameLower = String(existing.usernameLower || existing.username || '').toLowerCase().trim()
    let created = false

    if (!usernameLower){
      usernameLower = await reserveUniqueUsernameTx(tx, uid, displayName)
      created = !snap.exists
      tx.set(userRef, {
        uid,
        username: usernameLower,
        usernameLower,
        ...(email ? { email } : {}),
        ...(photoURL ? { photoURL } : {}),
        joined: snap.exists ? (existing.joined || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } else {
      // Best-effort: ensure the username index exists for older profiles.
      if (/^[a-z0-9._-]{3,32}$/.test(usernameLower)){
        const unameRef = db.doc(`usernames/${usernameLower}`)
        const unameSnap = await tx.get(unameRef)
        if (!unameSnap.exists){
          tx.set(unameRef, { uid, createdAt: FieldValue.serverTimestamp() }, { merge: false })
        }
      }
      // Best-effort: populate photoURL/email if missing.
      const patch = {}
      if (email && !existing.email) patch.email = email
      if (photoURL && !existing.photoURL) patch.photoURL = photoURL
      patch.updatedAt = FieldValue.serverTimestamp()
      tx.set(userRef, patch, { merge: true })
    }

    const finalPhoto = (photoURL && !existing.photoURL) ? photoURL : (existing.photoURL || photoURL || null)
    return { ok: true, uid, username: usernameLower, photoURL: finalPhoto, created }
  })

  return out
})

exports.userResetUsernameToGoogle = functions.https.onCall(async (_data, context) => {
  const auth = requireAuth(context)
  const uid = String(auth.uid || '')
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Missing uid')

  const userRecord = await admin.auth().getUser(uid)
  const displayName = String(userRecord.displayName || '').trim()
  if (!displayName){
    throw new functions.https.HttpsError('failed-precondition', 'Your Google account is missing a display name.')
  }

  const userRef = db.doc(`users/${uid}`)
  const res = await db.runTransaction(async (tx)=>{
    const snap = await tx.get(userRef)
    const existing = snap.exists ? (snap.data() || {}) : {}
    const oldLower = String(existing.usernameLower || existing.username || '').toLowerCase().trim()
    const nextLower = await reserveUniqueUsernameTx(tx, uid, displayName)

    tx.set(userRef, {
      uid,
      username: nextLower,
      usernameLower: nextLower,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    if (oldLower && oldLower !== nextLower && /^[a-z0-9._-]{3,32}$/.test(oldLower)){
      const oldRef = db.doc(`usernames/${oldLower}`)
      const oldSnap = await tx.get(oldRef)
      if (oldSnap.exists && String(oldSnap.data()?.uid || '') === uid){
        tx.delete(oldRef)
      }
    }

    return { ok: true, uid, username: nextLower, oldUsername: oldLower || null }
  })

  // Update cached authorName on existing posts/comments.
  const updated = await updateAuthorFieldsForUser(uid, { authorName: res.username })
  return { ...res, ...updated }
})

exports.userResetPhotoToGoogle = functions.https.onCall(async (_data, context) => {
  const auth = requireAuth(context)
  const uid = String(auth.uid || '')
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Missing uid')

  const userRecord = await admin.auth().getUser(uid)
  const photoURL = userRecord.photoURL ? String(userRecord.photoURL) : ''
  if (!photoURL){
    throw new functions.https.HttpsError('failed-precondition', 'Your Google account is missing a profile photo.')
  }

  await db.doc(`users/${uid}`).set({
    photoURL,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const updated = await updateAuthorFieldsForUser(uid, { authorPhoto: photoURL })
  return { ok: true, uid, photoURL, ...updated }
})

// -----------------------------
// Admin: purge legacy password users (and their posts/comments)
// -----------------------------

async function deleteDocsByAuthor(collectionName, uid){
  const authorUid = String(uid || '')
  if (!authorUid) return 0
  const col = db.collection(collectionName)
  let deleted = 0
  let last = null
  for (let i = 0; i < 80; i++){ // safety cap
    let q = col.where('author', '==', authorUid).orderBy(admin.firestore.FieldPath.documentId()).limit(400)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    const batch = db.batch()
    for (const d of snap.docs){
      batch.delete(d.ref)
      deleted++
    }
    await batch.commit()
    last = snap.docs[snap.docs.length - 1]
  }
  return deleted
}

async function deleteCommunityPostsByAuthor(uid){
  const authorUid = String(uid || '')
  if (!authorUid) return 0
  const col = db.collection('communityPosts')
  let deleted = 0
  let last = null
  for (let i = 0; i < 80; i++){ // safety cap
    let q = col.where('author', '==', authorUid).orderBy(admin.firestore.FieldPath.documentId()).limit(200)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs){
      await deleteCommentsForPost(d.id)
      await d.ref.delete()
      deleted++
    }
    last = snap.docs[snap.docs.length - 1]
  }
  return deleted
}

exports.adminPurgePasswordUsers = functions.https.onCall(async (data, context) => {
  await requireSteveAdmin(context)
  const dryRun = !!data?.dryRun
  const limit = clampInt(data?.limit, 1, 200)
  const confirm = String(data?.confirm || '').trim()
  if (!dryRun && confirm !== 'DELETE_PASSWORD_USERS'){
    throw new functions.https.HttpsError('invalid-argument', 'Missing confirm="DELETE_PASSWORD_USERS"')
  }

  const candidates = []
  let scanned = 0
  let pageToken = undefined
  for (let i = 0; i < 50; i++){
    const res = await admin.auth().listUsers(1000, pageToken)
    const users = res.users || []
    scanned += users.length
    for (const u of users){
      const providers = (u.providerData || []).map(p=>String(p.providerId || '')).filter(Boolean)
      const hasPassword = providers.includes('password')
      const hasGoogle = providers.includes('google.com')
      if (hasPassword && !hasGoogle){
        candidates.push({
          uid: u.uid,
          email: u.email || null,
          displayName: u.displayName || null,
          providers,
          createdAt: u.metadata?.creationTime || null,
        })
        if (candidates.length >= limit) break
      }
    }
    if (candidates.length >= limit) break
    pageToken = res.pageToken
    if (!pageToken) break
  }

  if (dryRun){
    // Best-effort: quick existence checks for content.
    const details = []
    for (const c of candidates){
      const uid = c.uid
      const [postSnap, commentSnap, userSnap] = await Promise.all([
        db.collection('communityPosts').where('author', '==', uid).limit(1).get(),
        db.collection('comments').where('author', '==', uid).limit(1).get(),
        db.doc(`users/${uid}`).get(),
      ])
      details.push({
        ...c,
        hasPosts: !postSnap.empty,
        hasComments: !commentSnap.empty,
        hasUserDoc: userSnap.exists,
        usernameLower: userSnap.exists ? (userSnap.data()?.usernameLower || userSnap.data()?.username || null) : null,
      })
    }
    return { ok: true, dryRun: true, scanned, limit, candidates: details }
  }

  const totals = {
    usersDeleted: 0,
    authUsersDeleted: 0,
    userDocsDeleted: 0,
    usernameDocsDeleted: 0,
    postsDeleted: 0,
    commentsDeleted: 0,
    errors: [],
  }

  for (const c of candidates){
    const uid = String(c.uid || '')
    if (!uid) continue
    try{
      // Read user doc to find usernameLower mapping.
      const userRef = db.doc(`users/${uid}`)
      const userSnap = await userRef.get()
      const userData = userSnap.exists ? (userSnap.data() || {}) : {}
      const usernameLower = String(userData.usernameLower || userData.username || '').toLowerCase().trim()

      totals.postsDeleted += await deleteCommunityPostsByAuthor(uid)
      totals.commentsDeleted += await deleteDocsByAuthor('comments', uid)

      if (userSnap.exists){
        await userRef.delete()
        totals.userDocsDeleted++
      }

      if (usernameLower && /^[a-z0-9._-]{3,32}$/.test(usernameLower)){
        const uref = db.doc(`usernames/${usernameLower}`)
        const usnap = await uref.get()
        if (usnap.exists && String(usnap.data()?.uid || '') === uid){
          await uref.delete()
          totals.usernameDocsDeleted++
        }
      }

      await admin.auth().deleteUser(uid)
      totals.authUsersDeleted++
      totals.usersDeleted++
    }catch(e){
      totals.errors.push({ uid, message: e?.message || String(e) })
    }
  }

  return { ok: true, dryRun: false, scanned, limit, totals }
})

// -----------------------------
// Moderation (stevesunhy only)
// -----------------------------

// Create an announcement post (channel=announcement) as "Quantara Team".
exports.adminCreateAnnouncementPost = functions.https.onCall(async (data, context) => {
  const { auth } = await requireSteveAdmin(context)
  const title = String(data?.title || '').trim().slice(0, 180)
  const post = String(data?.post || '').trim().slice(0, 80000)
  const bigCategory = String(data?.bigCategory || 'Discussion')
  const channel = 'announcement'
  const subjects = Array.isArray(data?.subjects) ? data.subjects.map(x=>String(x||'').trim()).filter(Boolean).slice(0, 12) : []
  const level = data?.level ? String(data.level) : null

  if (!title) throw new functions.https.HttpsError('invalid-argument', 'Missing title')
  if (!post) throw new functions.https.HttpsError('invalid-argument', 'Missing post')
  if (!subjects.length) throw new functions.https.HttpsError('invalid-argument', 'Missing subjects')

  const ref = await db.collection('communityPosts').add({
    title,
    post,
    bigCategory,
    channel,
    discussion: channel,
    subjects,
    ...(level ? { level } : {}),
    time: FieldValue.serverTimestamp(),
    likes: 0,
    comments: 0,
    starCount: 0,
    author: auth.uid,
    authorName: 'Quantara Team',
    authorPhoto: 'https://via.placeholder.com/24',
    hasImages: false,
    isAnnouncement: true,
  })
  return { postId: ref.id }
})

exports.adminDeletePost = functions.https.onCall(async (data, context) => {
  await requireSteveAdmin(context)
  const postId = String(data?.postId || '').trim()
  const reason = String(data?.reason || '').trim().slice(0, 500)
  if (!postId) throw new functions.https.HttpsError('invalid-argument', 'Missing postId')
  const ref = db.doc(`communityPosts/${postId}`)
  const snap = await ref.get()
  if (!snap.exists) return { ok: true, alreadyDeleted: true }
  const post = snap.data() || {}
  const authorUid = String(post.author || '')
  const title = String(post.title || '').slice(0, 180)

  if (authorUid){
    await sendSystemDm(authorUid, `Your post "${title}" was removed. ${reason ? `Reason: ${reason}` : ''}`.trim())
  }
  await deleteCommentsForPost(postId)
  await ref.delete()
  return { ok: true }
})

exports.adminDeleteComment = functions.https.onCall(async (data, context) => {
  await requireSteveAdmin(context)
  const commentId = String(data?.commentId || '').trim()
  const reason = String(data?.reason || '').trim().slice(0, 500)
  if (!commentId) throw new functions.https.HttpsError('invalid-argument', 'Missing commentId')
  const ref = db.doc(`comments/${commentId}`)
  const snap = await ref.get()
  if (!snap.exists) return { ok: true, alreadyDeleted: true }
  const c = snap.data() || {}
  const authorUid = String(c.author || '')
  const preview = String(c.content || '').slice(0, 80)
  if (authorUid){
    await sendSystemDm(authorUid, `Your comment "${preview}" was removed. ${reason ? `Reason: ${reason}` : ''}`.trim())
  }
  await ref.delete()
  return { ok: true }
})

exports.adminBanUser = functions.https.onCall(async (data, context) => {
  const { auth } = await requireSteveAdmin(context)
  const uid = String(data?.uid || '').trim()
  const durationMs = Number(data?.durationMs || 0)
  const reason = String(data?.reason || '').trim().slice(0, 500)
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid')
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new functions.https.HttpsError('invalid-argument', 'Invalid durationMs')

  const until = durationMs === 0
    ? admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100) // ~100y "permanent"
    : admin.firestore.Timestamp.fromMillis(Date.now() + durationMs)

  await db.doc(`users/${uid}`).set({
    banUntil: until,
    banReason: reason || null,
    bannedBy: auth.uid,
    bannedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await sendSystemDm(uid, `You have been banned until ${until.toDate().toISOString()}. ${reason ? `Reason: ${reason}` : ''}`.trim())
  return { ok: true, banUntil: until }
})

// Publish (or create) today's daily challenge.
// - Only allowed for stevesunhy (and admin claim).
// - Stores the answer encrypted so public Firestore reads won't reveal it.
exports.challengeUpsertDaily = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const dateKey = assertDateKey(data?.dateKey || todayKeyNY());
  const imageURL = String(data?.imageURL || '').trim();
  const questionLatex = String(data?.questionLatex || '').trim();
  const hint = String(data?.hint || '').trim();
  const difficulty = String(data?.difficulty || '').trim();
  const keyConcepts = Array.isArray(data?.keyConcepts) ? data.keyConcepts : [];
  const answer = normalizeAnswer(data?.answer);

  if (!questionLatex) throw new functions.https.HttpsError('invalid-argument', 'Missing questionLatex');
  if (imageURL && !imageURL.startsWith('http')) throw new functions.https.HttpsError('invalid-argument', 'Invalid imageURL');
  if (!answer) throw new functions.https.HttpsError('invalid-argument', 'Missing answer');
  if (hint.length > 5000) throw new functions.https.HttpsError('invalid-argument', 'Hint too long');
  if (difficulty.length > 40) throw new functions.https.HttpsError('invalid-argument', 'Difficulty too long');
  if (keyConcepts.length > 3) throw new functions.https.HttpsError('invalid-argument', 'Max 3 key concepts');

  const prof = await getUserProfile(auth.uid);
  const username = prof.username || 'anon';
  requireSteveUploader(username, context);

  const ref = db.doc(`dailyChallenges/${dateKey}`);
  const existing = await ref.get();
  const locked = existing.exists ? !!existing.data()?.locked : false;
  if (existing.exists && locked){
    throw new functions.https.HttpsError('failed-precondition', 'Challenge is locked (has submissions); cannot edit');
  }

  // Time window:
  // - publishes at 8:00PM America/New_York on dateKey
  // - submission deadline is 7:00PM America/New_York on the next day
  const publishAt = nyLocalToTimestamp(dateKey, 20, 0, 0, 0);
  const deadlineAt = nyLocalToTimestamp(addDaysDateKey(dateKey, 1), 19, 0, 0, 0);

  const enc = encryptAnswer(answer);
  const conceptsEnc = encryptConcepts(
    keyConcepts
      .map(s=>String(s || '').trim())
      .filter(Boolean)
      .slice(0, 3)
  );
  await ref.set({
    dateKey,
    imageURL,
    questionLatex,
    hint,
    difficulty,
    ...enc,
    ...conceptsEnc,
    publishAt,
    deadlineAt,
    locked: false,
    createdBy: auth.uid,
    createdByUsername: username,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: existing.exists ? (existing.data()?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, dateKey };
});

// Submit answer for today's challenge.
// - One submission per user per dateKey.
// - Does NOT reveal correctness until after deadline.
exports.challengeSubmitDaily = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const dateKey = assertDateKey(data?.dateKey || todayKeyNY());
  const answerRaw = String(data?.answer || '').trim();
  const answer = normalizeAnswer(answerRaw);
  const usedHint = !!data?.usedHint;
  const conceptsGuess = Array.isArray(data?.conceptsGuess) ? data.conceptsGuess : [];
  if (!answer) throw new functions.https.HttpsError('invalid-argument', 'Missing answer');

  const prof = await getUserProfile(auth.uid);
  const username = prof.username || 'anon';

  const challengeRef = db.doc(`dailyChallenges/${dateKey}`);
  const submissionRef = db.doc(`dailyChallenges/${dateKey}/submissions/${auth.uid}`);

  const result = await db.runTransaction(async (tx) => {
    const [challengeSnap, submissionSnap] = await Promise.all([
      tx.get(challengeRef),
      tx.get(submissionRef),
    ]);

    if (!challengeSnap.exists){
      throw new functions.https.HttpsError('failed-precondition', 'No challenge posted yet');
    }
    if (submissionSnap.exists){
      return {
        ok: true,
        dateKey,
        alreadySubmitted: true,
      };
    }

    const ch = challengeSnap.data() || {};

    // Enforce time window:
    // - publish: 8PM ET on dateKey
    // - deadline: 7PM ET next day
    const now = admin.firestore.Timestamp.now();
    const publishAt = ch.publishAt || nyLocalToTimestamp(dateKey, 20, 0, 0, 0);
    const deadlineAt = ch.deadlineAt || nyLocalToTimestamp(addDaysDateKey(dateKey, 1), 19, 0, 0, 0);
    if (now.toMillis() < publishAt.toMillis()){
      throw new functions.https.HttpsError('failed-precondition', 'Challenge not available yet (publishes 8:00pm ET)');
    }
    if (now.toMillis() > deadlineAt.toMillis()){
      throw new functions.https.HttpsError('failed-precondition', 'Submission deadline has passed');
    }

    let correctAnswerPlain = '';
    try{
      correctAnswerPlain = decryptAnswer(ch);
    }catch(_e){
      throw new functions.https.HttpsError('failed-precondition', 'Challenge answer not configured properly');
    }
    const isCorrect = normalizeAnswer(correctAnswerPlain) === answer;

    const officialConcepts = decryptConcepts(ch).map(normalizeAnswer).filter(Boolean);
    const guessNorm = conceptsGuess
      .map(s=>normalizeAnswer(s))
      .filter(Boolean)
      .slice(0, 3);
    const conceptHit = !isCorrect && guessNorm.some(g => officialConcepts.includes(g));

    let points = 0;
    if (usedHint){
      points = isCorrect ? 80 : 0;
    } else {
      points = isCorrect ? 100 : (conceptHit ? 60 : 0);
    }

    tx.set(submissionRef, {
      uid: auth.uid,
      username,
      submittedAt: FieldValue.serverTimestamp(),
      answer: answerRaw.slice(0, 400),
      answerNorm: answer,
      conceptsGuess: guessNorm,
      usedHint,
      isCorrect,
      conceptHit,
      points,
      revealAt: deadlineAt,
    }, { merge: true });

    // Lock the challenge once the first submission arrives (prevents editing the prompt/answer).
    if (!ch.locked){
      tx.set(challengeRef, { locked: true }, { merge: true });
    }

    // Do NOT reveal correctness/points to the client before the deadline.
    return { ok:true, dateKey, submitted:true, alreadySubmitted:false, revealAt: deadlineAt.toMillis() };
  });

  // Gamification: first submission for the day counts as participation.
  if (!result?.alreadySubmitted){
    const ref = gameRefFor(auth.uid)
    const eventRef = db.collection(`users/${auth.uid}/xpEvents`).doc()
    let potdCount = 0
    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref)
      const d = snap.exists ? (snap.data() || {}) : {}
      const oldXp = clampInt(d.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + 30, 0, 2_000_000_000)
      const level = levelFromXp(xp)
      potdCount = clampInt(d.potdParticipations, 0, 2_000_000_000) + 1
      tx.set(ref, {
        uid: auth.uid,
        xp,
        level,
        potdParticipations: potdCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(eventRef, {
        uid: auth.uid,
        amount: 30,
        reason: 'potd:participate',
        meta: { dateKey },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false })
    })
    if (potdCount === 1){
      await unlock(auth.uid, ACH.firstPOTD)
    }
  }

  return result;
});

// Reveal the user's result after the deadline, and update public leaderboard stats at that time
// (avoids leaking correctness via leaderboard before the reveal window).
exports.challengeRevealDaily = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const dateKey = assertDateKey(data?.dateKey || todayKeyNY());

  const prof = await getUserProfile(auth.uid);
  const username = prof.username || 'anon';

  const challengeRef = db.doc(`dailyChallenges/${dateKey}`);
  const submissionRef = db.doc(`dailyChallenges/${dateKey}/submissions/${auth.uid}`);
  const statsRef = db.doc(`challengeStats/${auth.uid}`);
  const dayRef = db.doc(`challengeStats/${auth.uid}/days/${dateKey}`);

  const out = await db.runTransaction(async (tx) => {
    const [chSnap, subSnap, statsSnap, daySnap] = await Promise.all([
      tx.get(challengeRef),
      tx.get(submissionRef),
      tx.get(statsRef),
      tx.get(dayRef),
    ]);

    if (!chSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'No challenge posted');
    const ch = chSnap.data() || {};
    const deadlineAt = ch.deadlineAt || nyLocalToTimestamp(addDaysDateKey(dateKey, 1), 19, 0, 0, 0);
    const now = admin.firestore.Timestamp.now();
    if (now.toMillis() < deadlineAt.toMillis()){
      return { ok:true, dateKey, status:'pending', revealAt: deadlineAt.toMillis() };
    }
    if (!subSnap.exists){
      return { ok:true, dateKey, status:'no-submission' };
    }

    const sub = subSnap.data() || {};
    const isCorrect = !!sub.isCorrect;
    const usedHint = !!sub.usedHint;
    const conceptHit = !!sub.conceptHit;
    const points = Number(sub.points || 0);

    // Apply to public leaderboard once (per user per day).
    if (!daySnap.exists){
      const prev = statsSnap.exists ? (statsSnap.data() || {}) : {};
      const prevDays = Number(prev.daysParticipated || 0);
      const prevTotal = Number(prev.totalPoints || 0);
      const daysParticipated = prevDays + 1;
      const totalPoints = prevTotal + points;
      const avgPoints = daysParticipated > 0 ? (totalPoints / daysParticipated) : 0;

      tx.set(dayRef, { dateKey, points, revealedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(statsRef, {
        uid: auth.uid,
        username,
        daysParticipated,
        totalPoints,
        avgPoints,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.set(submissionRef, { revealedAt: FieldValue.serverTimestamp() }, { merge: true });

    return { ok:true, dateKey, status:'revealed', isCorrect, points, usedHint, conceptHit };
  });

  return out;
});

// Set admin custom claim for the current user if they know the secret
exports.setAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const provided = (data && data.password) || '';

  // Prefer environment variable; optionally fall back to Functions config
  const expected = process.env.ADMIN_SECRET || functions.config().admin?.secret;
  if (!expected) {
    throw new functions.https.HttpsError('failed-precondition', 'Server not configured');
  }

  if (provided !== expected) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid secret');
  }

  await admin.auth().setCustomUserClaims(context.auth.uid, { admin: true });
  return { ok: true };
});

// Verify admin secret without changing claims
exports.verifyAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const provided = (data && data.password) || '';
  const expected = process.env.ADMIN_SECRET || functions.config().admin?.secret;
  if (!expected) {
    throw new functions.https.HttpsError('failed-precondition', 'Server not configured');
  }
  if (provided !== expected) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid secret');
  }
  return { ok: true };
});

// Perform wiki mutations server-side (create, update, delete)
exports.wikiCreate = functions.https.onCall(async (data, context) => {
  requireAdminClaim(context)
  const provided = (data && data.password) || null; // optional if you want to pass again
  // We rely on verifyAdmin() having been called just before; you can enforce secret again if desired
  const { data: docData } = data || {};
  if (!docData || !docData.title) throw new functions.https.HttpsError('invalid-argument','Missing article data');
  const db = admin.firestore();
  const ref = await db.collection('articles').add(docData);
  return { id: ref.id };
});

exports.wikiUpdate = functions.https.onCall(async (data, context) => {
  requireAdminClaim(context)
  const { id, data: docData } = data || {};
  if (!id || !docData) throw new functions.https.HttpsError('invalid-argument','Missing id or data');
  const db = admin.firestore();
  await db.collection('articles').doc(id).set(docData, { merge: true });
  return { ok: true };
});

exports.wikiDelete = functions.https.onCall(async (data, context) => {
  requireAdminClaim(context)
  const { id } = data || {};
  if (!id) throw new functions.https.HttpsError('invalid-argument','Missing id');
  await db.collection('articles').doc(id).delete();
  return { ok: true };
});

// -----------------------------
// Community: one-like-per-user + counters via subcollections
// -----------------------------

// On user creation, initialize gamification state and unlock "Joined Quantara".
exports.onUserCreated = functions.firestore
  .document('users/{uid}')
  .onCreate(async (_snap, ctx) => {
    const uid = String(ctx.params?.uid || '')
    if (!uid) return
    // Ensure game doc exists
    await gameRefFor(uid).set({
      uid,
      xp: 0,
      level: 0,
      equippedBadgeId: '',
      postsCount: 0,
      commentsCount: 0,
      likesReceived: 0,
      arithmeticAttemptsCount: 0,
      potdParticipations: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await unlock(uid, ACH.joined)
  });

// When a post is created, award the author +2xp and track post counts.
exports.onCommunityPostCreated = functions.firestore
  .document('communityPosts/{postId}')
  .onCreate(async (snap, ctx) => {
    const postId = String(ctx.params?.postId || '')
    const authorUid = String(snap.data()?.author || '')
    if (!authorUid) return

    let postsCount = 0
    await db.runTransaction(async (tx)=>{
      const gameRef = gameRefFor(authorUid)
      const eventRef = db.collection(`users/${authorUid}/xpEvents`).doc()
      const gSnap = await tx.get(gameRef)
      const g = gSnap.exists ? (gSnap.data() || {}) : {}
      const oldXp = clampInt(g.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + 2, 0, 2_000_000_000)
      const level = levelFromXp(xp)
      postsCount = clampInt(g.postsCount, 0, 2_000_000_000) + 1
      tx.set(gameRef, {
        uid: authorUid,
        xp,
        level,
        postsCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(eventRef, {
        uid: authorUid,
        amount: 2,
        reason: 'community:post',
        meta: { postId },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false })
    })

    await maybeUnlockPosts(authorUid, postsCount)
  });

// When a user likes a post, increment `communityPosts/{postId}.likes`
exports.onPostLikeCreated = functions.firestore
  .document('communityPosts/{postId}/likes/{userId}')
  .onCreate(async (_snap, ctx) => {
    const { postId } = ctx.params;
    await db.doc(`communityPosts/${postId}`).set({ likes: FieldValue.increment(1) }, { merge: true });

    // Gamification: author gains +1xp per like received; unlock like milestones.
    const postSnap = await db.doc(`communityPosts/${postId}`).get().catch(()=>null)
    const authorUid = String(postSnap?.data?.()?.author || postSnap?.data()?.author || '')
    if (!authorUid) return

    let likesReceived = 0
    await db.runTransaction(async (tx)=>{
      const gameRef = gameRefFor(authorUid)
      const eventRef = db.collection(`users/${authorUid}/xpEvents`).doc()
      const gSnap = await tx.get(gameRef)
      const g = gSnap.exists ? (gSnap.data() || {}) : {}
      const oldXp = clampInt(g.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + 1, 0, 2_000_000_000)
      const level = levelFromXp(xp)
      likesReceived = clampInt(g.likesReceived, 0, 2_000_000_000) + 1
      tx.set(gameRef, {
        uid: authorUid,
        xp,
        level,
        likesReceived,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(eventRef, {
        uid: authorUid,
        amount: 1,
        reason: 'community:like_received',
        meta: { postId },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false })
    })
    await maybeUnlockLikes(authorUid, likesReceived)
  });

// When a user unlikes a post, decrement the counter (clamped client-side; this just decrements)
exports.onPostLikeDeleted = functions.firestore
  .document('communityPosts/{postId}/likes/{userId}')
  .onDelete(async (_snap, ctx) => {
    const { postId } = ctx.params;
    await db.doc(`communityPosts/${postId}`).set({ likes: FieldValue.increment(-1) }, { merge: true });

    // Gamification: undo +1xp for unlikes (prevents like/unlike farming).
    const postSnap = await db.doc(`communityPosts/${postId}`).get().catch(()=>null)
    const authorUid = String(postSnap?.data?.()?.author || postSnap?.data()?.author || '')
    if (!authorUid) return

    await db.runTransaction(async (tx)=>{
      const gameRef = gameRefFor(authorUid)
      const eventRef = db.collection(`users/${authorUid}/xpEvents`).doc()
      const gSnap = await tx.get(gameRef)
      const g = gSnap.exists ? (gSnap.data() || {}) : {}
      const oldXp = clampInt(g.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp - 1, 0, 2_000_000_000)
      const level = levelFromXp(xp)
      const likesReceived = Math.max(0, clampInt(g.likesReceived, 0, 2_000_000_000) - 1)
      tx.set(gameRef, {
        uid: authorUid,
        xp,
        level,
        likesReceived,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(eventRef, {
        uid: authorUid,
        amount: -1,
        reason: 'community:like_removed',
        meta: { postId },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false })
    })
  });

// Comments live in a top-level `comments` collection.
// Each comment has a `postId` field so we can maintain `communityPosts/{postId}.comments`.
exports.onCommentCreated = functions.firestore
  .document('comments/{commentId}')
  .onCreate(async (snap, _ctx) => {
    const postId = snap.data()?.postId;
    if (!postId) return;
    await db.doc(`communityPosts/${postId}`).set({ comments: FieldValue.increment(1) }, { merge: true });

    // Gamification:
    // - commenter earns +2xp up to 5x/day (NY date)
    // - track total comments for achievements
    const authorUid = String(snap.data()?.author || '')
    if (!authorUid) return
    const dateKey = todayKeyNY()

    let commentsCount = 0
    await db.runTransaction(async (tx)=>{
      const gameRef = gameRefFor(authorUid)
      const dailyRef = dailyRefFor(authorUid, dateKey)
      const eventRef = db.collection(`users/${authorUid}/xpEvents`).doc()
      const [gSnap, dSnap] = await Promise.all([tx.get(gameRef), tx.get(dailyRef)])
      const g = gSnap.exists ? (gSnap.data() || {}) : {}
      const d = dSnap.exists ? (dSnap.data() || {}) : {}

      // Always increment lifetime comment count
      commentsCount = clampInt(g.commentsCount, 0, 2_000_000_000) + 1

      // Award xp only if under daily cap
      const awardedSoFar = clampInt(d.commentAwards, 0, 1_000_000)
      const canAward = awardedSoFar < 5
      const delta = canAward ? 2 : 0

      const oldXp = clampInt(g.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + delta, 0, 2_000_000_000)
      const level = levelFromXp(xp)

      tx.set(gameRef, {
        uid: authorUid,
        xp,
        level,
        commentsCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })

      tx.set(dailyRef, {
        uid: authorUid,
        dateKey,
        commentAwards: canAward ? (awardedSoFar + 1) : awardedSoFar,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: dSnap.exists ? (d.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      }, { merge: true })

      if (delta){
        tx.set(eventRef, {
          uid: authorUid,
          amount: 2,
          reason: 'community:comment',
          meta: { postId, dateKey },
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: false })
      }
    })

    if (commentsCount === 1){
      await unlock(authorUid, ACH.firstComment)
    }
  });

exports.onCommentDeleted = functions.firestore
  .document('comments/{commentId}')
  .onDelete(async (snap, _ctx) => {
    const postId = snap.data()?.postId;
    if (!postId) return;
    await db.doc(`communityPosts/${postId}`).set({ comments: FieldValue.increment(-1) }, { merge: true });
  });

// Comment likes live under each comment: `comments/{commentId}/likes/{userId}`
exports.onCommentLikeCreated = functions.firestore
  .document('comments/{commentId}/likes/{userId}')
  .onCreate(async (_snap, ctx) => {
    const { commentId } = ctx.params;
    await db.doc(`comments/${commentId}`).set({ likes: FieldValue.increment(1) }, { merge: true });
  });

exports.onCommentLikeDeleted = functions.firestore
  .document('comments/{commentId}/likes/{userId}')
  .onDelete(async (_snap, ctx) => {
    const { commentId } = ctx.params;
    await db.doc(`comments/${commentId}`).set({ likes: FieldValue.increment(-1) }, { merge: true });
  });

// Stars (bookmarks): stored per-user at users/{uid}/stars/{postId}
// Maintain an aggregate `starCount` on the post doc.
exports.onPostStarCreated = functions.firestore
  .document('users/{uid}/stars/{postId}')
  .onCreate(async (_snap, ctx) => {
    const { postId } = ctx.params;
    await db.doc(`communityPosts/${postId}`).set({ starCount: FieldValue.increment(1) }, { merge: true });
  });

exports.onPostStarDeleted = functions.firestore
  .document('users/{uid}/stars/{postId}')
  .onDelete(async (_snap, ctx) => {
    const { postId } = ctx.params;
    await db.doc(`communityPosts/${postId}`).set({ starCount: FieldValue.increment(-1) }, { merge: true });
  });

// -----------------------------
// Arithmetic game attempts (arithmetic.html)
// -----------------------------

// Award +20xp for completing an attempt, up to 3x/day (NY date).
exports.onGameAttemptFinalized = functions.firestore
  .document('gameAttempts/{attemptId}')
  .onUpdate(async (change, ctx) => {
    const before = change.before.data() || {}
    const after = change.after.data() || {}
    if (before.endedAt || !after.endedAt) return
    const mode = String(after.mode || '').trim()
    if (mode === 'custom') return
    const uid = String(after.uid || '').trim()
    if (!uid) return

    const dateKey = todayKeyNY()
    let attemptsCount = 0

    await db.runTransaction(async (tx)=>{
      const gameRef = gameRefFor(uid)
      const dailyRef = dailyRefFor(uid, dateKey)
      const eventRef = db.collection(`users/${uid}/xpEvents`).doc()
      const [gSnap, dSnap] = await Promise.all([tx.get(gameRef), tx.get(dailyRef)])
      const g = gSnap.exists ? (gSnap.data() || {}) : {}
      const d = dSnap.exists ? (dSnap.data() || {}) : {}

      attemptsCount = clampInt(g.arithmeticAttemptsCount, 0, 2_000_000_000) + 1
      const awardedSoFar = clampInt(d.arithmeticAwards, 0, 1_000_000)
      const canAward = awardedSoFar < 3
      const delta = canAward ? 20 : 0

      const oldXp = clampInt(g.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + delta, 0, 2_000_000_000)
      const level = levelFromXp(xp)

      tx.set(gameRef, {
        uid,
        xp,
        level,
        arithmeticAttemptsCount: attemptsCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })

      tx.set(dailyRef, {
        uid,
        dateKey,
        arithmeticAwards: canAward ? (awardedSoFar + 1) : awardedSoFar,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: dSnap.exists ? (d.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      }, { merge: true })

      if (delta){
        tx.set(eventRef, {
          uid,
          amount: 20,
          reason: 'arithmetic:attempt',
          meta: { attemptId: String(ctx.params?.attemptId || ''), mode, dateKey },
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: false })
      }
    })

    if (attemptsCount === 1){
      await unlock(uid, ACH.firstArithmetic)
    }
  });

// -----------------------------
// Friendships
// -----------------------------

exports.onFriendshipAccepted = functions.firestore
  .document('friendships/{fid}')
  .onUpdate(async (change, _ctx) => {
    const before = change.before.data() || {}
    const after = change.after.data() || {}
    if (String(before.status || '') !== 'pending') return
    if (String(after.status || '') !== 'accepted') return
    const users = Array.isArray(after.users) ? after.users.map(String).filter(Boolean) : []
    if (users.length !== 2) return
    await Promise.all(users.map(uid => unlock(uid, ACH.addedFriend)))
  });

// -----------------------------
// Chat: DM chats + unread counts
// -----------------------------

// Message docs live at: chats/{chatId}/messages/{messageId}
// Chat doc fields updated:
// - lastMessage (truncated)
// - lastMessageAt
// - unreadCounts.{uid} incremented for all other participants
exports.onChatMessageCreated = functions.firestore
  .document('chats/{chatId}/messages/{messageId}')
  .onCreate(async (snap, ctx) => {
    const { chatId } = ctx.params;
    const msg = snap.data() || {};
    const senderUid = String(msg.senderUid || '');
    const kind = String(msg.kind || 'text');
    const text = String(msg.text || '');
    const createdAt = msg.createdAt || FieldValue.serverTimestamp();

    const chatRef = db.doc(`chats/${chatId}`);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;

    const chat = chatSnap.data() || {};
    const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : [];
    if (!participants.length) return;

    function lastMessagePreview(){
      if (kind === 'image') return '📷 Photo'
      if (kind === 'post') return `Post: ${String(msg.postTitle || '').trim() || 'shared'}`
      if (kind === 'wiki') return `Wiki: ${String(msg.wikiTitle || msg.wikiSlug || '').trim() || 'shared'}`
      const t = String(text || '').trim()
      return t.length > 140 ? (t.slice(0, 140) + '…') : t
    }

    const updates = {
      lastMessage: lastMessagePreview(),
      lastMessageAt: createdAt,
      lastSenderUid: senderUid || null,
      lastMessageKind: kind || 'text',
    };

    for (const uid of participants){
      if (!uid || uid === senderUid) continue;
      updates[`unreadCounts.${uid}`] = FieldValue.increment(1);
    }

    await chatRef.set(updates, { merge: true });
  });

// Mark a chat as read for the current user (sets unreadCounts.{uid} = 0).
exports.chatMarkRead = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const chatId = String(data?.chatId || '').trim();
  if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'Missing chatId');

  const ref = db.doc(`chats/${chatId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Chat not found');

  const chat = snap.data() || {};
  const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : [];
  if (!participants.includes(auth.uid)){
    throw new functions.https.HttpsError('permission-denied', 'Not a participant');
  }

  await ref.set({
    [`unreadCounts.${auth.uid}`]: 0,
    [`lastReadAt.${auth.uid}`]: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// -----------------------------
// Group chats
// -----------------------------

function uniqStrings(arr){
  const out = []
  const seen = new Set()
  for (const v of (arr || [])){
    const s = String(v || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

exports.groupCreate = functions.https.onCall(async (data, context) => {
  try{
    const auth = requireAuth(context)
    const title = String(data?.title || '').trim()
    const raw = data?.memberUids
    if (!Array.isArray(raw)){
      throw new functions.https.HttpsError('invalid-argument', 'memberUids must be an array')
    }
    const memberUids = uniqStrings(raw).filter(uid => uid !== auth.uid)

    // must include at least 2 other people => min 3 including creator
    if (memberUids.length < 2){
      throw new functions.https.HttpsError('invalid-argument', 'Group chats require at least 3 people (you + 2 others).')
    }

    const participants = uniqStrings([auth.uid, ...memberUids])
    if (participants.length < 3){
      throw new functions.https.HttpsError('invalid-argument', 'Group chats require at least 3 people.')
    }

    const ref = db.collection('chats').doc()
    const now = FieldValue.serverTimestamp()
    await ref.set({
      kind: 'group',
      title: title || 'Group chat',
      participants,
      createdAt: now,
      createdBy: auth.uid,
      admins: { [auth.uid]: true },
      lastMessage: '',
      lastMessageAt: now,
      unreadCounts: {},
    }, { merge: false })

    // Optional system message
    await ref.collection('messages').add({
      kind: 'text',
      senderUid: auth.uid,
      text: 'Created the group chat',
      createdAt: now,
      system: true,
    })

    return { ok: true, chatId: ref.id }
  }catch(e){
    functions.logger.error('groupCreate failed', e)
    if (e instanceof functions.https.HttpsError) throw e
    throw new functions.https.HttpsError('internal', e?.message || 'Internal error')
  }
})

exports.groupInvite = functions.https.onCall(async (data, context) => {
  try{
    const auth = requireAuth(context)
    const chatId = String(data?.chatId || '').trim()
    const uid = String(data?.uid || '').trim()
    if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'Missing chatId')
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid')

    const ref = db.doc(`chats/${chatId}`)
    const snap = await ref.get()
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Chat not found')
    const chat = snap.data() || {}
    if (chat.kind !== 'group') throw new functions.https.HttpsError('failed-precondition', 'Not a group chat')
    const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : []
    if (!participants.includes(auth.uid)){
      throw new functions.https.HttpsError('permission-denied', 'Not a participant')
    }

    await ref.set({
      participants: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    await ref.collection('messages').add({
      kind: 'text',
      senderUid: auth.uid,
      text: 'Invited someone to the group',
      createdAt: FieldValue.serverTimestamp(),
      system: true,
    })

    return { ok: true }
  }catch(e){
    functions.logger.error('groupInvite failed', e)
    if (e instanceof functions.https.HttpsError) throw e
    throw new functions.https.HttpsError('internal', e?.message || 'Internal error')
  }
})

exports.groupRemoveMember = functions.https.onCall(async (data, context) => {
  try{
    const auth = requireAuth(context)
    const chatId = String(data?.chatId || '').trim()
    const uid = String(data?.uid || '').trim()
    if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'Missing chatId')
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid')

    const ref = db.doc(`chats/${chatId}`)
    const snap = await ref.get()
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Chat not found')
    const chat = snap.data() || {}
    if (chat.kind !== 'group') throw new functions.https.HttpsError('failed-precondition', 'Not a group chat')
    const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : []
    if (!participants.includes(auth.uid)){
      throw new functions.https.HttpsError('permission-denied', 'Not a participant')
    }

    const creator = String(chat.createdBy || '')
    const admins = chat.admins || {}
    const isAdmin = (auth.uid === creator) || admins[auth.uid] === true
    if (!isAdmin){
      throw new functions.https.HttpsError('permission-denied', 'Only creator/admins can remove members')
    }
    if (uid === creator){
      throw new functions.https.HttpsError('failed-precondition', 'Cannot remove the creator')
    }

    const updates = {
      participants: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    }
    updates[`admins.${uid}`] = FieldValue.delete()
    updates[`unreadCounts.${uid}`] = FieldValue.delete()
    updates[`lastReadAt.${uid}`] = FieldValue.delete()

    await ref.set(updates, { merge: true })

    await ref.collection('messages').add({
      kind: 'text',
      senderUid: auth.uid,
      text: 'Removed someone from the group',
      createdAt: FieldValue.serverTimestamp(),
      system: true,
    })

    return { ok: true }
  }catch(e){
    functions.logger.error('groupRemoveMember failed', e)
    if (e instanceof functions.https.HttpsError) throw e
    throw new functions.https.HttpsError('internal', e?.message || 'Internal error')
  }
})

exports.groupSetAdmin = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context)
  const chatId = String(data?.chatId || '').trim()
  const uid = String(data?.uid || '').trim()
  const makeAdmin = !!data?.makeAdmin
  if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'Missing chatId')
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid')

  const ref = db.doc(`chats/${chatId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Chat not found')
  const chat = snap.data() || {}
  if (chat.kind !== 'group') throw new functions.https.HttpsError('failed-precondition', 'Not a group chat')
  if (String(chat.createdBy || '') !== auth.uid){
    throw new functions.https.HttpsError('permission-denied', 'Only the creator can set admins')
  }
  const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : []
  if (!participants.includes(uid)){
    throw new functions.https.HttpsError('failed-precondition', 'User is not in the group')
  }
  await ref.set({
    [`admins.${uid}`]: makeAdmin ? true : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true }
})

// Set group chat photo (creator/admin only). The client uploads to Storage and passes the URL.
exports.groupSetPhoto = functions.https.onCall(async (data, context) => {
  try{
    const auth = requireAuth(context)
    const chatId = String(data?.chatId || '').trim()
    const photoURL = String(data?.photoURL || '').trim()
    if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'Missing chatId')
    if (!photoURL.startsWith('http')) throw new functions.https.HttpsError('invalid-argument', 'Missing photoURL')

    const ref = db.doc(`chats/${chatId}`)
    const snap = await ref.get()
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Chat not found')
    const chat = snap.data() || {}
    if (chat.kind !== 'group') throw new functions.https.HttpsError('failed-precondition', 'Not a group chat')

    const participants = Array.isArray(chat.participants) ? chat.participants.map(String) : []
    if (!participants.includes(auth.uid)){
      throw new functions.https.HttpsError('permission-denied', 'Not a participant')
    }

    const creator = String(chat.createdBy || '')
    const admins = chat.admins || {}
    const isAdmin = (auth.uid === creator) || admins[auth.uid] === true
    if (!isAdmin){
      throw new functions.https.HttpsError('permission-denied', 'Only creator/admins can set the photo')
    }

    await ref.set({ photoURL, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { ok: true }
  }catch(e){
    functions.logger.error('groupSetPhoto failed', e)
    if (e instanceof functions.https.HttpsError) throw e
    throw new functions.https.HttpsError('internal', e?.message || 'Internal error')
  }
})


// -----------------------------
// Gamification (XP / Level / Achievements / Badges)
// -----------------------------

// NOTE: This is intentionally minimal scaffolding.
// You’ll provide the XP rules + achievement list later; we’ll plug those into these functions.

function clampInt(n, min, max){
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  const i = Math.trunc(v)
  return Math.min(max, Math.max(min, i))
}

// Level curve requested by user:
// - Level 0 -> 1 costs 10 XP
// - For level 1..100: each next level costs +10 XP more than previous
//   (i.e., cost to go from L->L+1 is 10*(L+1) for L=0..99)
// - For level 100+: each level costs 1000 XP
function xpForLevel(level){
  const L = clampInt(level, 0, 1_000_000)
  if (L <= 0) return 0
  if (L <= 100){
    // 10 * (1 + 2 + ... + L) = 10 * L*(L+1)/2
    return Math.trunc(10 * (L * (L + 1)) / 2)
  }
  const xp100 = Math.trunc(10 * (100 * 101) / 2) // 50500
  return xp100 + 1000 * (L - 100)
}

function levelFromXp(xp){
  const x = Math.max(0, Number(xp) || 0)
  const xp100 = xpForLevel(100) // 50500
  if (x < xp100){
    // Solve: 10 * L*(L+1)/2 <= x  => 5L^2 + 5L - x <= 0
    const disc = 25 + 20 * x
    const L = Math.floor((-5 + Math.sqrt(disc)) / 10)
    return Math.max(0, L)
  }
  return 100 + Math.floor((x - xp100) / 1000)
}

function gameRefFor(uid){
  return db.doc(`users/${uid}/gameState/main`)
}

function dailyRefFor(uid, dateKey){
  return db.doc(`users/${uid}/gameDaily/${dateKey}`)
}

const TIER_BONUS_XP = {
  bronze: 2,
  silver: 20,
  gold: 50,
  legendary: 200,
}

function assertTier(tier){
  const t = String(tier || '').toLowerCase().trim()
  if (!['bronze','silver','gold','legendary'].includes(t)){
    throw new functions.https.HttpsError('invalid-argument', 'Invalid tier')
  }
  return t
}

function slugifyId(s, maxLen){
  const v = String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return v.slice(0, maxLen || 80) || 'item'
}

async function applyXpDelta({ uid, delta, reason, meta }){
  const d = clampInt(delta, -1_000_000, 1_000_000)
  if (!d) return { xp: 0, level: 0 }
  const ref = gameRefFor(uid)
  const eventRef = db.collection(`users/${uid}/xpEvents`).doc()

  let out = { xp: 0, level: 0 }
  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(ref)
    const cur = snap.exists ? (snap.data() || {}) : {}
    const oldXp = clampInt(cur.xp, 0, 2_000_000_000)
    const xp = clampInt(oldXp + d, 0, 2_000_000_000)
    const level = levelFromXp(xp)
    tx.set(ref, {
      uid,
      xp,
      level,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    tx.set(eventRef, {
      uid,
      amount: d,
      reason: String(reason || '').slice(0, 100),
      meta: (meta && typeof meta === 'object') ? meta : null,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false })
    out = { xp, level }
  })
  return out
}

async function awardXpWithDailyCap({ uid, dateKey, counterField, cap, amount, reason, meta }){
  const ref = gameRefFor(uid)
  const dailyRef = dailyRefFor(uid, dateKey)
  const eventRef = db.collection(`users/${uid}/xpEvents`).doc()
  const amt = clampInt(amount, 0, 1_000_000)
  const max = clampInt(cap, 0, 1_000_000)
  const field = String(counterField || '').trim()
  if (!amt || !field || !max) return { awarded: false, xp: 0, level: 0 }

  let out = { awarded: false, xp: 0, level: 0 }
  await db.runTransaction(async (tx)=>{
    const [snap, dailySnap] = await Promise.all([tx.get(ref), tx.get(dailyRef)])
    const cur = snap.exists ? (snap.data() || {}) : {}
    const daily = dailySnap.exists ? (dailySnap.data() || {}) : {}
    const used = clampInt(daily[field], 0, 1_000_000)
    if (used >= max){
      out = { awarded: false, xp: clampInt(cur.xp, 0, 2_000_000_000), level: clampInt(cur.level, 0, 1_000_000) }
      return
    }
    const oldXp = clampInt(cur.xp, 0, 2_000_000_000)
    const xp = clampInt(oldXp + amt, 0, 2_000_000_000)
    const level = levelFromXp(xp)
    tx.set(ref, { uid, xp, level, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(dailyRef, {
      uid,
      dateKey,
      [field]: used + 1,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: dailySnap.exists ? (daily.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
    }, { merge: true })
    tx.set(eventRef, {
      uid,
      amount: amt,
      reason: String(reason || '').slice(0, 100),
      meta: (meta && typeof meta === 'object') ? meta : null,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false })
    out = { awarded: true, xp, level }
  })
  return out
}

async function unlockAchievementAndBadge({ uid, tier, name, condition, achievementId }){
  const t = assertTier(tier)
  const id = String(achievementId || '').trim().slice(0, 80) || slugifyId(name, 80)

  const achRef = db.doc(`users/${uid}/achievements/${id}`)
  const badgeRef = db.doc(`users/${uid}/badges/${id}`)
  const gameRef = gameRefFor(uid)
  const eventRef = db.collection(`users/${uid}/xpEvents`).doc()

  const bonus = clampInt(TIER_BONUS_XP[t], 0, 1_000_000)
  let didUnlock = false
  await db.runTransaction(async (tx)=>{
    const [achSnap, badgeSnap, gameSnap] = await Promise.all([
      tx.get(achRef),
      tx.get(badgeRef),
      tx.get(gameRef),
    ])
    if (achSnap.exists){
      return
    }
    didUnlock = true
    tx.set(achRef, {
      uid,
      achievementId: id,
      tier: t,
      name: String(name || '').slice(0, 80),
      condition: String(condition || '').slice(0, 180),
      unlockedAt: FieldValue.serverTimestamp(),
    }, { merge: false })

    // Badge mirrors the achievement id (equip-able).
    if (!badgeSnap.exists){
      tx.set(badgeRef, {
        uid,
        badgeId: id,
        tier: t,
        name: String(name || '').slice(0, 80),
        earnedAt: FieldValue.serverTimestamp(),
      }, { merge: false })

      // Bonus XP for earning the badge (per your tier bonus table).
      const cur = gameSnap.exists ? (gameSnap.data() || {}) : {}
      const oldXp = clampInt(cur.xp, 0, 2_000_000_000)
      const xp = clampInt(oldXp + bonus, 0, 2_000_000_000)
      const level = levelFromXp(xp)
      tx.set(gameRef, { uid, xp, level, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.set(eventRef, {
        uid,
        amount: bonus,
        reason: `badge:${id}`,
        meta: { tier: t },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: false })
    }
  })
  return { ok: true, unlocked: didUnlock, id }
}

const ACH = {
  joined: { id:'joined_quantara', tier:'bronze', name:'Joined Quantara', condition:'Create an account' },
  firstPost: { id:'first_post', tier:'bronze', name:'First Post', condition:'Send a post for the first time' },
  firstComment: { id:'first_comment', tier:'bronze', name:'First Comment', condition:'Post a comment for the first time' },
  firstArithmetic: { id:'first_arithmetic', tier:'bronze', name:'Arithmetic Newcomer', condition:'Participate in the arithmetic game for the first time' },
  firstPOTD: { id:'first_potd', tier:'bronze', name:'Daily Challenger', condition:'Participate in Problem of the Day' },
  addedFriend: { id:'added_friend', tier:'bronze', name:'Made a Friend', condition:'Add a friend' },
  postGotLike: { id:'post_got_like', tier:'bronze', name:'First Like', condition:'Your post got a like' },

  tenPosts: { id:'ten_posts', tier:'silver', name:'Ten Posts', condition:'Send ten posts' },
  tenLikes: { id:'ten_likes', tier:'silver', name:'Ten Likes', condition:'Your posts got ten likes' },

  hundredPosts: { id:'hundred_posts', tier:'gold', name:'Century Poster', condition:'Send 100 posts' },
  hundredLikes: { id:'hundred_likes', tier:'gold', name:'Hundred Likes', condition:'Your posts got 100 likes' },

  thousandLikes: { id:'thousand_likes', tier:'legendary', name:'1,000 Likes', condition:'Your posts got 1,000 likes' },
}

async function unlock(uid, a){
  return unlockAchievementAndBadge({
    uid,
    tier: a.tier,
    name: a.name,
    condition: a.condition,
    achievementId: a.id,
  })
}

async function maybeUnlockPosts(uid, postsCount){
  if (postsCount === 1) await unlock(uid, ACH.firstPost)
  if (postsCount === 10) await unlock(uid, ACH.tenPosts)
  if (postsCount === 100) await unlock(uid, ACH.hundredPosts)
}

async function maybeUnlockLikes(uid, likesReceived){
  if (likesReceived === 1) await unlock(uid, ACH.postGotLike)
  if (likesReceived === 10) await unlock(uid, ACH.tenLikes)
  if (likesReceived === 100) await unlock(uid, ACH.hundredLikes)
  if (likesReceived === 1000) await unlock(uid, ACH.thousandLikes)
}

exports.gamificationEnsure = functions.https.onCall(async (_data, context) => {
  const auth = requireAuth(context)
  const ref = gameRefFor(auth.uid)
  const prof = await getUserProfile(auth.uid)
  const usernameLower = String(prof.usernameLower || prof.username || '').toLowerCase().trim()
  const isAdmin = !!auth?.token?.admin
  const isSteve = isAdmin && usernameLower === 'stevesunhy'
  const minXp = isSteve ? 1000 : 0

  await db.runTransaction(async (tx)=>{
    const snap = await tx.get(ref)
    if (!snap.exists){
      tx.set(ref, {
        uid: auth.uid,
        xp: minXp,
        level: levelFromXp(minXp),
        equippedBadgeId: '',
        postsCount: 0,
        commentsCount: 0,
        likesReceived: 0,
        arithmeticAttemptsCount: 0,
        potdParticipations: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: false })
      return
    }
    const d = snap.data() || {}
    const xp = Math.max(clampInt(d.xp, 0, 2_000_000_000), minXp)
    const level = clampInt(d.level, 0, 1_000_000)
    tx.set(ref, {
      uid: auth.uid,
      xp,
      level: Math.max(level, levelFromXp(xp)),
      equippedBadgeId: typeof d.equippedBadgeId === 'string' ? d.equippedBadgeId : '',
      postsCount: clampInt(d.postsCount, 0, 2_000_000_000),
      commentsCount: clampInt(d.commentsCount, 0, 2_000_000_000),
      likesReceived: clampInt(d.likesReceived, 0, 2_000_000_000),
      arithmeticAttemptsCount: clampInt(d.arithmeticAttemptsCount, 0, 2_000_000_000),
      potdParticipations: clampInt(d.potdParticipations, 0, 2_000_000_000),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  const snap = await ref.get()
  const d = snap.data() || {}
  return { ok: true, xp: d.xp || 0, level: (typeof d.level === 'number' ? d.level : 0), equippedBadgeId: d.equippedBadgeId || '' }
})

exports.gamificationAddXp = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context)
  const amount = clampInt(data?.amount, 0, 1_000_000)
  const reason = String(data?.reason || '').trim().slice(0, 100)
  const meta = (data?.meta && typeof data.meta === 'object') ? data.meta : null

  if (amount <= 0){
    throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive integer')
  }
  const out = await applyXpDelta({ uid: auth.uid, delta: amount, reason, meta })
  return { ok: true, ...out }
})

exports.gamificationEquipBadge = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context)
  const badgeId = String(data?.badgeId || '').trim().slice(0, 64)
  if (!badgeId){
    await gameRefFor(auth.uid).set({
      equippedBadgeId: '',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ok: true, equippedBadgeId: '' }
  }

  // Must already be earned.
  const badgeRef = db.doc(`users/${auth.uid}/badges/${badgeId}`)
  const badgeSnap = await badgeRef.get()
  if (!badgeSnap.exists){
    throw new functions.https.HttpsError('failed-precondition', 'Badge not earned')
  }

  await gameRefFor(auth.uid).set({
    equippedBadgeId: badgeId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, equippedBadgeId: badgeId }
})

exports.gamificationDailyCheckIn = functions.https.onCall(async (_data, context) => {
  const auth = requireAuth(context)
  const dateKey = todayKeyNY()
  const gameRef = gameRefFor(auth.uid)
  const dailyRef = dailyRefFor(auth.uid, dateKey)
  const eventRef = db.collection(`users/${auth.uid}/xpEvents`).doc()

  const out = await db.runTransaction(async (tx)=>{
    const [gSnap, dSnap] = await Promise.all([tx.get(gameRef), tx.get(dailyRef)])
    const daily = dSnap.exists ? (dSnap.data() || {}) : {}
    if (daily.checkedIn === true){
      return { ok: true, dateKey, alreadyCheckedIn: true }
    }
    const g = gSnap.exists ? (gSnap.data() || {}) : {}
    const oldXp = clampInt(g.xp, 0, 2_000_000_000)
    const xp = clampInt(oldXp + 2, 0, 2_000_000_000)
    const level = levelFromXp(xp)

    tx.set(gameRef, { uid: auth.uid, xp, level, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(dailyRef, {
      uid: auth.uid,
      dateKey,
      checkedIn: true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: dSnap.exists ? (daily.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
    }, { merge: true })
    tx.set(eventRef, {
      uid: auth.uid,
      amount: 2,
      reason: 'daily:checkin',
      meta: { dateKey },
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false })
    return { ok: true, dateKey, alreadyCheckedIn: false, xp, level }
  })

  return out
})

// Admin-only: award 1000xp for a successful wiki contribution (manual approval).
exports.gamificationAwardWikiContribution = functions.https.onCall(async (data, context) => {
  requireAdminClaim(context)
  const uid = String(data?.uid || '').trim()
  const articleId = String(data?.articleId || '').trim().slice(0, 80)
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid')
  const out = await applyXpDelta({ uid, delta: 1000, reason: 'wiki:successful', meta: { articleId } })
  return { ok: true, ...out }
})

// Admin-only: add a custom achievement + badge to a user (intended for stevesunhy).
exports.gamificationAdminAddAchievement = functions.https.onCall(async (data, context) => {
  const auth = requireAdminClaim(context)
  const uid = String(data?.uid || auth.uid).trim()
  const name = String(data?.name || '').trim().slice(0, 80)
  const condition = String(data?.condition || '').trim().slice(0, 180)
  const tier = assertTier(data?.tier)
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'Missing name')
  const baseId = slugifyId(name, 60)
  const suffix = Date.now().toString(36).slice(-4)
  const achievementId = `${baseId}_${suffix}`.slice(0, 80)
  const res = await unlockAchievementAndBadge({ uid, tier, name, condition, achievementId })
  return { ok: true, ...res }
})

// Admin-only debug utilities (useful during rollout).
exports.gamificationDebugGrantAchievement = functions.https.onCall(async (data, context) => {
  const auth = requireAdminClaim(context)
  const uid = String(data?.uid || auth.uid).trim()
  const achievementId = String(data?.achievementId || '').trim().slice(0, 80)
  const tier = assertTier(data?.tier)
  const meta = (data?.meta && typeof data.meta === 'object') ? data.meta : null
  const name = String(meta?.name || achievementId || 'Achievement').slice(0, 80)
  const condition = String(meta?.condition || '').slice(0, 180)
  const res = await unlockAchievementAndBadge({ uid, tier, name, condition, achievementId })
  return { ok: true, ...res }
})

exports.gamificationDebugGrantBadge = functions.https.onCall(async (data, context) => {
  const auth = requireAdminClaim(context)
  const uid = String(data?.uid || auth.uid).trim()
  const badgeId = String(data?.badgeId || '').trim().slice(0, 64)
  const tier = assertTier(data?.tier || 'bronze')
  const name = String(data?.name || badgeId || 'Badge').slice(0, 80)
  if (!badgeId) throw new functions.https.HttpsError('invalid-argument', 'Missing badgeId')

  const badgeRef = db.doc(`users/${uid}/badges/${badgeId}`)
  await badgeRef.set({
    uid,
    badgeId,
    tier,
    name,
    earnedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true }
})


