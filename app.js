(() => {
    'use strict';

    const AUDIO_DIR = 'audio/';
    const METADATA_CSV = 'audio_metadata.csv';
    const COOKIE_NAME = 'selectedAudio';
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
    };

    const state = {
        metadata: {},
        files: [],
        currentFile: null,
        loopStart: null,
        loopEnd: null,
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

    // --- クッキー ---
    function saveSelectedAudio(filename) {
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        document.cookie = COOKIE_NAME + '=' + encodeURIComponent(filename) +
            '; expires=' + expires.toUTCString() + '; path=/; SameSite=Lax';
    }

    function getSelectedAudio() {
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
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
            await fetchFileSizes();
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

    function populateAudioSelector() {
        dom.audioSelect.innerHTML = '';
        state.files.forEach((filename) => {
            const option = document.createElement('option');
            option.value = filename;
            const meta = state.metadata[filename];
            option.textContent = meta.title + (meta.fileSizeMB ? ' [' + meta.fileSizeMB + 'MB]' : '');
            dom.audioSelect.appendChild(option);
        });

        if (state.files.length === 0) return;

        // クッキーに保存された音源、なければ最新（最後）の音源を選択
        const saved = getSelectedAudio();
        const defaultFile = (saved && state.metadata[saved]) ? saved : state.files[state.files.length - 1];
        dom.audioSelect.value = defaultFile;
        changeAudio(defaultFile);
    }

    // --- 音声切り替え ---
    function changeAudio(filename) {
        state.currentFile = filename;
        dom.audioSource.src = AUDIO_DIR + filename;
        dom.audio.load();

        updateAudioInfo();
        setStatus('');
        updatePlayPauseButton();
        clearLoopRange();
        resetSpeed();
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
            changeAudio(e.target.value);
            saveSelectedAudio(e.target.value);
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
        loadAudioMetadata();
    });
})();
