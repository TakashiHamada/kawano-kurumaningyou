// ES モジュールとして読み込まれる（index.html の type="module"）。
// モジュールは strict モードで、DOM の構築後に実行される。

const AUDIO_DIR = 'audio/';
const IMG_DIR = 'img/';
// 音声と同名（拡張子違い）の画像を img/ から自動的に探す際の対象拡張子
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const METADATA_CSV = 'audio_metadata.csv';
const DEFAULT_SPEED = 1;
const REWIND_SECONDS = 5;
// CSV の項目が空のときに表示する文字列
const EMPTY_FIELD = '-';

const dom = {
    audio: document.getElementById('audioPlayer'),
    audioSelect: document.getElementById('audioSelect'),
    audioTitle: document.getElementById('audioTitle'),
    speaker: document.getElementById('speaker'),
    recordedDate: document.getElementById('recordedDate'),
    refreshBtn: document.getElementById('refreshBtn'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    rewindBtn: document.getElementById('rewindBtn'),
    loopStartBtn: document.getElementById('loopStartBtn'),
    loopEndBtn: document.getElementById('loopEndBtn'),
    loopClearBtn: document.getElementById('loopClearBtn'),
    loopRangeDisplay: document.getElementById('loopRangeDisplay'),
    speedButtons: document.querySelectorAll('.speed-button'),
    status: document.getElementById('status'),
    imageToggleBtn: document.getElementById('imageToggleBtn'),
    imageInline: document.getElementById('imageInline'),
};

const state = {
    // ファイル名 → 音声情報。CSV の行順を保持する
    tracks: new Map(),
    currentTrack: null,
    loopStart: null,
    loopEnd: null,
    // 直前の timeupdate 時点の再生位置（終了点を「再生で通過した」かの判定用）
    lastTime: 0,
};

// --- ユーティリティ ---
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function setStatus(message) {
    dom.status.textContent = message;
}

// HEAD リクエストで存在確認する。存在しない・通信失敗時は null を返す
async function fetchHead(url) {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        return res.ok ? res : null;
    } catch {
        return null;
    }
}

// 音声が未選択の間は再生系ボタンを無効化する
function setControlsEnabled(enabled) {
    const buttons = [
        dom.playPauseBtn,
        dom.rewindBtn,
        dom.loopStartBtn,
        dom.loopEndBtn,
        dom.loopClearBtn,
        ...dom.speedButtons,
    ];
    for (const btn of buttons) {
        btn.disabled = !enabled;
    }
}

// --- メタデータ読み込み ---
async function loadAudioMetadata() {
    try {
        // 「更新」ボタンで CSV の変更がすぐ反映されるよう、キャッシュを検証してから使う
        const response = await fetch(METADATA_CSV, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Failed to load metadata: ${response.status} ${response.statusText}`);
        }
        parseCsv(await response.text());
        await fetchFileSizes();
        populateAudioSelector();
    } catch (error) {
        console.error('メタデータの読み込みに失敗しました:', error);
        setStatus('メタデータの読み込みに失敗しました。');
    }
}

// CSV（filename,title,speaker,recorded_date）を読み込む。
// 手作業で編集されるため、BOM・CRLF・項目前後の空白・空行を許容する。
function parseCsv(csvText) {
    const lines = csvText.replace(/^﻿/, '').split(/\r?\n/);
    // 1行目はヘッダー
    for (const line of lines.slice(1)) {
        const [filename, title, speaker, recordedDate] = line.split(',').map((field) => field.trim());
        if (!filename || state.tracks.has(filename)) continue;
        state.tracks.set(filename, {
            filename,
            title: title || filename,
            speaker: speaker || EMPTY_FIELD,
            recordedDate: recordedDate || EMPTY_FIELD,
            fileSizeMB: null,
            // 関連画像。音声を選択したときに img/ から探して設定する（findImages）
            images: null,
        });
    }
}

function audioUrl(filename) {
    return AUDIO_DIR + encodeURIComponent(filename);
}

async function fetchFileSizes() {
    await Promise.all([...state.tracks.values()].map(async (track) => {
        const res = await fetchHead(audioUrl(track.filename));
        const sizeBytes = Number(res?.headers.get('Content-Length'));
        // 取得できなかった場合は表示しない
        if (sizeBytes > 0) {
            track.fileSizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        }
    }));
}

function populateAudioSelector() {
    // 先頭にプレースホルダーを表示し、起動時は音声を自動ダウンロードしない
    const placeholder = new Option('音声を選択してください', '');
    const options = [...state.tracks.values()].map((track) => new Option(
        track.title + (track.fileSizeMB ? ` [${track.fileSizeMB}MB]` : ''),
        track.filename
    ));
    dom.audioSelect.replaceChildren(placeholder, ...options);

    // ユーザーが任意で選択するまでダウンロードしないため、ここでは自動選択しない
    dom.audioSelect.value = '';
    setControlsEnabled(false);
    setStatus('');
}

// --- 音声切り替え ---
function changeAudio(filename) {
    const track = state.tracks.get(filename);
    if (!track) return;
    state.currentTrack = track;
    // src を設定すると読み込みが始まり、再生位置と再生速度は初期値に戻る
    dom.audio.src = audioUrl(filename);
    state.lastTime = 0;

    setControlsEnabled(true);
    updateAudioInfo();
    updateImageToggle();
    setStatus('');
    updatePlayPauseButton();
    clearLoopRange();
    resetSpeed();
}

function updateAudioInfo() {
    const track = state.currentTrack;
    dom.audioTitle.textContent = track?.title ?? '音声情報';
    dom.speaker.textContent = track?.speaker ?? EMPTY_FIELD;
    dom.recordedDate.textContent = track?.recordedDate ?? EMPTY_FIELD;
}

// --- 関連画像（台本） ---
// img/ に音声ファイルと同名（拡張子違い）の画像があれば関連画像とする。
// 起動時に全音声分を調べると通信が多いため、選択された音声だけを調べて結果を覚えておく。
async function findImages(track) {
    if (track.images) return track.images;
    const baseName = track.filename.replace(/\.[^/.]+$/, '');
    const candidates = IMAGE_EXTENSIONS.map((ext) => IMG_DIR + encodeURIComponent(`${baseName}.${ext}`));
    const found = await Promise.all(candidates.map(fetchHead));
    track.images = candidates.filter((_, i) => found[i]);
    return track.images;
}

// audio-info 右下のアイコンの状態を更新する。
// 参照画像があればアクティブ（押せる）、なければ非アクティブにする。
async function updateImageToggle() {
    hideImages();
    dom.imageToggleBtn.disabled = true;
    const track = state.currentTrack;
    const images = await findImages(track);
    // 調べている間に別の音声が選ばれた場合は何もしない
    if (track !== state.currentTrack) return;
    dom.imageToggleBtn.disabled = images.length === 0;
}

function toggleImages() {
    if (dom.imageInline.hidden) {
        showImages();
    } else {
        hideImages();
    }
}

// audio-info の下に関連画像を表示する
function showImages() {
    const images = state.currentTrack?.images ?? [];
    if (images.length === 0) return;
    const elements = images.map((src, index) => {
        const img = document.createElement('img');
        img.className = 'image-inline-img';
        img.src = src;
        // 複数枚あるときはスクリーンリーダー用に連番で区別する
        img.alt = images.length > 1 ? `台本 ${index + 1}` : '台本';
        // タップで拡大・縮小を切り替え
        img.addEventListener('click', () => img.classList.toggle('zoomed'));
        return img;
    });
    dom.imageInline.replaceChildren(...elements);
    dom.imageInline.hidden = false;
    setImageToggleShowing(true);
}

function hideImages() {
    dom.imageInline.hidden = true;
    dom.imageInline.replaceChildren();
    setImageToggleShowing(false);
}

// 画像表示中はアイコンを × に、非表示中は画像アイコンにする（切り替えは CSS）
function setImageToggleShowing(showing) {
    dom.imageToggleBtn.classList.toggle('showing', showing);
    dom.imageToggleBtn.setAttribute('aria-expanded', String(showing));
    dom.imageToggleBtn.setAttribute('aria-label', showing ? '台本を閉じる' : '台本を表示');
}

// --- 再生制御 ---
function play() {
    // 読み込み失敗や音声切り替えで再生が中断されると Promise が reject される
    dom.audio.play().catch((error) => {
        if (error.name === 'AbortError') return;
        console.error('再生に失敗しました:', error);
        setStatus('再生できませんでした');
    });
}

function togglePlayPause() {
    if (dom.audio.paused) {
        play();
    } else {
        dom.audio.pause();
    }
}

function rewind() {
    dom.audio.currentTime = Math.max(0, dom.audio.currentTime - REWIND_SECONDS);
    setStatus(`${REWIND_SECONDS}秒巻き戻しました`);
}

function updatePlayPauseButton() {
    dom.playPauseBtn.textContent = dom.audio.paused ? '▶ 再生' : '一時停止';
}

// --- ループ範囲 ---
function hasLoopRange() {
    return state.loopStart !== null && state.loopEnd !== null;
}

function setLoopStart() {
    state.loopStart = dom.audio.currentTime;
    // 開始点が終了点以降なら終了点をクリア
    if (state.loopEnd !== null && state.loopStart >= state.loopEnd) {
        state.loopEnd = null;
    }
    updateLoopRange();
    setStatus(`開始点を ${formatTime(state.loopStart)} に設定しました`);
}

function setLoopEnd() {
    // 開始点が未設定なら先頭を開始点とする
    const start = state.loopStart ?? 0;
    const end = dom.audio.currentTime;
    if (end <= start) {
        setStatus('終了点は開始点より後に設定してください');
        return;
    }
    state.loopStart = start;
    state.loopEnd = end;
    updateLoopRange();
    setStatus(`終了点を ${formatTime(end)} に設定しました`);
}

function clearLoopRange() {
    state.loopStart = null;
    state.loopEnd = null;
    updateLoopRange();
}

function updateLoopRange() {
    // 区間ループ中は音声末尾での折り返しを自前で行う（handleEnded）。
    // ブラウザ標準のループだと先頭へ戻ってしまうため。
    dom.audio.loop = !hasLoopRange();

    if (hasLoopRange()) {
        dom.loopRangeDisplay.textContent =
            `${formatTime(state.loopStart)} → ${formatTime(state.loopEnd)} をループ中`;
    } else if (state.loopStart !== null) {
        dom.loopRangeDisplay.textContent =
            `${formatTime(state.loopStart)} → （終了点を設定してください）`;
    } else {
        dom.loopRangeDisplay.textContent = '全体をループ再生';
    }
}

// 再生が終了点を通過したときだけ開始点へ戻す。
// スライダー操作で終了点より後へ移動した場合はそのまま再生を続ける。
function enforceLoop() {
    const current = dom.audio.currentTime;
    const previous = state.lastTime;
    state.lastTime = current;
    if (dom.audio.seeking || !hasLoopRange()) return;
    // 一時停止中に現在位置を終了点にした場合（previous === loopEnd）も、
    // 再生を再開して進んだ時点で折り返す
    if (previous <= state.loopEnd && current > previous && current >= state.loopEnd) {
        dom.audio.currentTime = state.loopStart;
    }
}

// シーク（スライダー操作・巻き戻し・ループ）後の位置を基準にし直す
function handleSeeking() {
    state.lastTime = dom.audio.currentTime;
}

// 区間ループ中に音声の末尾まで再生した場合（終了点が末尾付近、
// または終了点より後へシークした場合）は開始点から再生を続ける
function handleEnded() {
    if (!hasLoopRange()) return;
    dom.audio.currentTime = state.loopStart;
    play();
}

// --- 再生速度 ---
function setSpeed(speed) {
    dom.audio.playbackRate = speed;
    for (const btn of dom.speedButtons) {
        const active = parseFloat(btn.dataset.speed) === speed;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    }
}

function resetSpeed() {
    setSpeed(DEFAULT_SPEED);
}

// --- イベント登録 ---
function bindEvents() {
    dom.refreshBtn.addEventListener('click', () => location.reload());

    dom.audioSelect.addEventListener('change', (e) => {
        if (!e.target.value) return; // プレースホルダー選択時は何もしない
        changeAudio(e.target.value);
    });

    dom.playPauseBtn.addEventListener('click', togglePlayPause);
    dom.rewindBtn.addEventListener('click', rewind);

    dom.loopStartBtn.addEventListener('click', setLoopStart);
    dom.loopEndBtn.addEventListener('click', setLoopEnd);
    dom.loopClearBtn.addEventListener('click', () => {
        clearLoopRange();
        setStatus('ループ範囲を解除しました（全体ループ）');
    });

    for (const btn of dom.speedButtons) {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);
            setSpeed(speed);
            setStatus(`再生速度: ${speed}x`);
        });
    }

    // 関連画像（台本）の表示・非表示トグル
    dom.imageToggleBtn.addEventListener('click', toggleImages);

    dom.audio.addEventListener('timeupdate', enforceLoop);
    dom.audio.addEventListener('seeking', handleSeeking);
    dom.audio.addEventListener('ended', handleEnded);
    dom.audio.addEventListener('play', () => {
        setStatus('再生中...');
        updatePlayPauseButton();
    });
    dom.audio.addEventListener('pause', () => {
        // 区間ループで末尾に達したときの一時的な停止は表示しない
        if (!dom.audio.ended) {
            setStatus('一時停止中');
        }
        updatePlayPauseButton();
    });
    dom.audio.addEventListener('error', () => {
        // 音声未選択（src なし）のときは対象外
        if (!state.currentTrack) return;
        setStatus('音声の読み込みに失敗しました');
        updatePlayPauseButton();
    });
}

// --- 初期化 ---
// 再生系ボタンは index.html で無効化済み。音声が選択されると有効になる
bindEvents();
updateLoopRange();
loadAudioMetadata();
