(() => {
    'use strict';

    const AUDIO_DIR = 'audio/';
    const IMG_DIR = 'img/';
    // 音声と同名（拡張子違い）の画像を img/ から自動的に探す際の対象拡張子
    const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
    const METADATA_CSV = 'audio_metadata.csv';
    const DEFAULT_SPEED = 1;
    const REWIND_SECONDS = 5;

    const dom = {
        audio: document.getElementById('audioPlayer'),
        audioSource: document.querySelector('#audioPlayer source'),
        audioSelect: document.getElementById('audioSelect'),
        audioTitle: document.getElementById('audioTitle'),
        speaker: document.getElementById('speaker'),
        recordedDate: document.getElementById('recordedDate'),
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
        metadata: {},
        files: [],
        currentFile: null,
        loopStart: null,
        loopEnd: null,
        currentImages: [],
    };

    // --- ユーティリティ ---
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    }

    function setStatus(message) {
        dom.status.textContent = message;
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
        buttons.forEach((btn) => {
            if (btn) btn.disabled = !enabled;
        });
    }

    // --- メタデータ読み込み ---
    async function loadAudioMetadata() {
        try {
            const response = await fetch(METADATA_CSV);
            if (!response.ok) {
                throw new Error('Failed to load metadata: ' + response.status + ' ' + response.statusText);
            }
            const csvText = await response.text();
            parseCsv(csvText);
            // ファイルサイズ取得と関連画像探索は独立しているので並列化する
            await Promise.all([fetchFileSizes(), fetchRelatedImages()]);
            populateAudioSelector();
        } catch (error) {
            console.error('メタデータの読み込みに失敗しました:', error);
            setStatus('メタデータの読み込みに失敗しました。');
        }
    }

    function parseCsv(csvText) {
        const lines = csvText.trim().split('\n');
        // 1行目はヘッダー
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const [filename, title, speakerName, date] = line.split(',');
            state.metadata[filename] = {
                title: title,
                speaker: speakerName,
                recordedDate: date,
                // 関連画像は img/ から音声と同名のファイルを探して設定する
                images: [],
            };
            state.files.push(filename);
        }
    }

    async function fetchFileSizes() {
        await Promise.all(state.files.map(async (filename) => {
            try {
                const res = await fetch(AUDIO_DIR + filename, { method: 'HEAD' });
                if (!res.ok) return;
                const size = res.headers.get('Content-Length');
                if (!size) return;
                const sizeBytes = Number(size);
                if (Number.isFinite(sizeBytes)) {
                    state.metadata[filename].fileSizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
                }
            } catch (e) {
                // ファイルサイズ取得失敗時は表示しない
            }
        }));
    }

    // img/ に音声ファイルと同名（拡張子違い）の画像があれば関連画像として登録する
    async function fetchRelatedImages() {
        await Promise.all(state.files.map(async (filename) => {
            const baseName = filename.replace(/\.[^/.]+$/, '');
            const images = [];
            for (const ext of IMAGE_EXTENSIONS) {
                const path = IMG_DIR + baseName + '.' + ext;
                try {
                    const res = await fetch(path, { method: 'HEAD' });
                    if (res.ok) images.push(path);
                } catch (e) {
                    // 画像が存在しない場合は無視する
                }
            }
            state.metadata[filename].images = images;
        }));
    }

    function populateAudioSelector() {
        dom.audioSelect.innerHTML = '';

        // 先頭にプレースホルダーを表示し、起動時は音声を自動ダウンロードしない
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '音声を選択してください';
        dom.audioSelect.appendChild(placeholder);

        state.files.forEach((filename) => {
            const option = document.createElement('option');
            option.value = filename;
            const meta = state.metadata[filename];
            option.textContent = meta.title + (meta.fileSizeMB ? ' [' + meta.fileSizeMB + 'MB]' : '');
            dom.audioSelect.appendChild(option);
        });

        // ユーザーが任意で選択するまでダウンロードしないため、ここでは自動選択しない
        // 音声未選択の間は再生系ボタンを無効化しておく
        dom.audioSelect.value = '';
        setControlsEnabled(false);
        setStatus('');
    }

    // --- 音声切り替え ---
    function changeAudio(filename) {
        state.currentFile = filename;
        dom.audioSource.src = AUDIO_DIR + filename;
        dom.audio.load();

        setControlsEnabled(true);
        updateAudioInfo();
        updateImageToggle();
        setStatus('');
        updatePlayPauseButton();
        clearLoopRange();
        resetSpeed();
    }

    // --- 関連画像（台本） ---
    // audio-info 右下のアイコンの状態を更新する。
    // 参照画像があればアクティブ（押せる）、なければ非アクティブにする。
    function updateImageToggle() {
        const meta = state.metadata[state.currentFile];
        state.currentImages = (meta && meta.images) || [];
        hideImages();
        dom.imageToggleBtn.disabled = state.currentImages.length === 0;
    }

    function toggleImages() {
        if (dom.imageToggleBtn.disabled) return;
        if (dom.imageInline.hidden) {
            showImages();
        } else {
            hideImages();
        }
    }

    // audio-info の下に関連画像を表示し、アイコンを × に切り替える
    function showImages() {
        if (state.currentImages.length === 0) return;
        dom.imageInline.innerHTML = '';
        const total = state.currentImages.length;
        state.currentImages.forEach((src, index) => {
            const img = document.createElement('img');
            img.className = 'image-inline-img';
            img.src = src;
            // 複数枚あるときはスクリーンリーダー用に連番で区別する
            img.alt = total > 1 ? '台本 ' + (index + 1) : '台本';
            // タップで拡大・縮小を切り替え
            img.addEventListener('click', () => img.classList.toggle('zoomed'));
            dom.imageInline.appendChild(img);
        });
        dom.imageInline.hidden = false;
        dom.imageToggleBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        dom.imageToggleBtn.classList.add('showing');
        dom.imageToggleBtn.setAttribute('aria-label', '台本を閉じる');
    }

    // 画像を隠し、アイコンを画像アイコンに戻す
    function hideImages() {
        dom.imageInline.hidden = true;
        dom.imageInline.innerHTML = '';
        dom.imageToggleBtn.innerHTML = '<i class="fa-regular fa-image"></i>';
        dom.imageToggleBtn.classList.remove('showing');
        dom.imageToggleBtn.setAttribute('aria-label', '台本を表示');
    }

    function updateAudioInfo() {
        const meta = state.metadata[state.currentFile];
        if (meta) {
            dom.audioTitle.textContent = meta.title;
            dom.speaker.textContent = meta.speaker;
            dom.recordedDate.textContent = meta.recordedDate;
        } else {
            dom.audioTitle.textContent = '音声情報';
            dom.speaker.textContent = '-';
            dom.recordedDate.textContent = '-';
        }
    }

    // --- 再生制御 ---
    function togglePlayPause() {
        if (dom.audio.paused) {
            dom.audio.play();
        } else {
            dom.audio.pause();
        }
    }

    function rewind() {
        dom.audio.currentTime = Math.max(0, dom.audio.currentTime - REWIND_SECONDS);
        setStatus(REWIND_SECONDS + '秒巻き戻しました');
    }

    function updatePlayPauseButton() {
        dom.playPauseBtn.textContent = dom.audio.paused ? '▶ 再生' : '一時停止';
    }

    // --- ループ範囲 ---
    function setLoopStart() {
        state.loopStart = dom.audio.currentTime;
        // 開始点が終了点以降なら終了点をクリア
        if (state.loopEnd !== null && state.loopStart >= state.loopEnd) {
            state.loopEnd = null;
        }
        updateLoopRangeDisplay();
        setStatus('開始点を ' + formatTime(state.loopStart) + ' に設定しました');
    }

    function setLoopEnd() {
        if (state.loopStart !== null && dom.audio.currentTime <= state.loopStart) {
            setStatus('終了点は開始点より後に設定してください');
            return;
        }
        state.loopEnd = dom.audio.currentTime;
        if (state.loopStart === null) {
            state.loopStart = 0;
        }
        updateLoopRangeDisplay();
        setStatus('終了点を ' + formatTime(state.loopEnd) + ' に設定しました');
    }

    function clearLoopRange() {
        state.loopStart = null;
        state.loopEnd = null;
        updateLoopRangeDisplay();
    }

    function updateLoopRangeDisplay() {
        if (state.loopStart !== null && state.loopEnd !== null) {
            dom.loopRangeDisplay.textContent =
                formatTime(state.loopStart) + ' → ' + formatTime(state.loopEnd) + ' をループ中';
        } else if (state.loopStart !== null) {
            dom.loopRangeDisplay.textContent =
                formatTime(state.loopStart) + ' → （終了点を設定してください）';
        } else {
            dom.loopRangeDisplay.textContent = '全体をループ再生';
        }
    }

    function enforceLoop() {
        if (state.loopStart !== null && state.loopEnd !== null &&
            dom.audio.currentTime >= state.loopEnd) {
            dom.audio.currentTime = state.loopStart;
        }
    }

    // --- 再生速度 ---
    function setSpeed(speed, button) {
        dom.audio.playbackRate = speed;
        dom.speedButtons.forEach(b => b.classList.remove('active'));
        if (button) button.classList.add('active');
        setStatus('再生速度: ' + speed + 'x');
    }

    function resetSpeed() {
        dom.audio.playbackRate = DEFAULT_SPEED;
        dom.speedButtons.forEach(b => b.classList.remove('active'));
        const defaultBtn = document.querySelector('.speed-button[data-speed="' + DEFAULT_SPEED + '"]');
        if (defaultBtn) defaultBtn.classList.add('active');
    }

    // --- イベント登録 ---
    function bindEvents() {
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

        dom.speedButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                setSpeed(parseFloat(btn.dataset.speed), btn);
            });
        });

        // 関連画像（台本）の表示・非表示トグル
        dom.imageToggleBtn.addEventListener('click', toggleImages);

        dom.audio.addEventListener('timeupdate', enforceLoop);
        dom.audio.addEventListener('play', () => {
            setStatus('再生中...');
            updatePlayPauseButton();
        });
        dom.audio.addEventListener('pause', () => {
            if (dom.audio.currentTime < dom.audio.duration) {
                setStatus('一時停止中');
            }
            updatePlayPauseButton();
        });
    }

    // --- 初期化 ---
    window.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        // メタデータ読み込み・音声選択が済むまで再生系ボタンを無効化
        setControlsEnabled(false);
        loadAudioMetadata();
    });
})();
