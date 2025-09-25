// renderer-browser.js
// Electron 의존성을 제거하고 브라우저에서 동작하도록 변환한 renderer.js (원본 로직 유지)

const playPauseBtn = document.getElementById('play-pause-btn');
const addFilesBtn = document.getElementById('add-files-btn');
const vuNeedle = document.getElementById('vu-needle');
const volumeSlider = document.getElementById('volume-slider');
const audioPlayer = document.getElementById('audio-player');
const playlistElement = document.getElementById('playlist');
const nowPlayingElement = document.getElementById('now-playing');
const fileInput = document.getElementById('file-input');

let playlist = []; // will store { file: File, url: objectURL }
let currentTrackIndex = -1;
let isPlaying = false;

// Web Audio API setup
let audioContext;
let source;
let analyser;
let gainNode;
let filters = [];

const FREQUENCY_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

function setupAudioContext() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    source = audioContext.createMediaElementSource(audioPlayer);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    gainNode = audioContext.createGain();

    // Create filters (same as 원본)
    FREQUENCY_BANDS.forEach(freq => {
        const filter = audioContext.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        filters.push(filter);
    });

    // Connect: source -> analyser -> gain -> filters... -> destination
    source.connect(analyser);
    analyser.connect(gainNode);
    filters.reduce((prev, curr) => prev.connect(curr), gainNode);
    filters[filters.length - 1].connect(audioContext.destination);

    updateVUMeter();
}

function updateVUMeter() {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const avg = sum / bufferLength;

        const angle = (avg / 255) * 180 - 90;
        vuNeedle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    };

    draw();
}

// ADD 버튼 -> 파일 선택창 열기
addFilesBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newItems = files.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    playlist = [...playlist, ...newItems];
    renderPlaylist();
    if (currentTrackIndex === -1) {
        playTrack(0);
    }
    // reset input so same file can be added again if needed
    fileInput.value = '';
});

// Play / Pause
playPauseBtn.addEventListener('click', async () => {
    if (currentTrackIndex === -1 && playlist.length > 0) {
        playTrack(0);
        return;
    }

    if (isPlaying) {
        audioPlayer.pause();
    } else {
        // ensure audio context resumed by user gesture
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        audioPlayer.play();
    }
});

// Volume control using GainNode
volumeSlider.addEventListener('input', (e) => {
    if (gainNode) {
        gainNode.gain.value = e.target.value;
    } else {
        audioPlayer.volume = e.target.value; // fallback
    }
});

audioPlayer.onplay = () => {
    isPlaying = true;
    playPauseBtn.textContent = 'PAUSE';
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
};

audioPlayer.onpause = () => {
    isPlaying = false;
    playPauseBtn.textContent = 'PLAY';
};

function deleteTrack(index) {
    if (index < 0 || index >= playlist.length) return;

    // If deleting current track, stop and clear source
    if (index === currentTrackIndex) {
        audioPlayer.pause();
        audioPlayer.src = '';
        isPlaying = false;
        playPauseBtn.textContent = 'PLAY';
        nowPlayingElement.textContent = 'GEMINI RETRO PLAYER';
        currentTrackIndex = -1;
    }

    // Revoke object URL to free memory
    try {
        URL.revokeObjectURL(playlist[index].url);
    } catch (e) { /* ignore */ }

    playlist.splice(index, 1);

    if (index < currentTrackIndex) {
        currentTrackIndex--;
    } else if (currentTrackIndex === -1 && playlist.length > 0) {
        currentTrackIndex = 0;
    } else if (currentTrackIndex >= playlist.length && playlist.length > 0) {
        currentTrackIndex = playlist.length - 1;
    } else if (playlist.length === 0) {
        currentTrackIndex = -1;
    }

    renderPlaylist();
}

function renderPlaylist() {
    playlistElement.innerHTML = '';
    playlist.forEach((item, index) => {
        const li = document.createElement('li');
        li.classList.add('playlist-item');

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'X';
        deleteBtn.classList.add('delete-btn');
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteTrack(index);
        });

        const trackName = document.createElement('span');
        trackName.textContent = (item.file && item.file.name) ? item.file.name : ('Track ' + (index+1));
        trackName.addEventListener('click', () => {
            playTrack(index);
        });

        li.appendChild(deleteBtn);
        li.appendChild(trackName);

        if (index === currentTrackIndex) {
            li.classList.add('active');
        }

        playlistElement.appendChild(li);
    });
}

function playTrack(index) {
    if (index < 0 || index >= playlist.length) return;

    if (!audioContext) {
        setupAudioContext();
    }

    currentTrackIndex = index;
    const item = playlist[index];
    audioPlayer.src = item.url;
    audioPlayer.play();

    nowPlayingElement.textContent = (item.file && item.file.name) ? item.file.name.toUpperCase() : `TRACK ${index+1}`;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: (item.file && item.file.name) ? item.file.name : `Track ${index+1}`,
            artist: 'Unknown Artist', // You might want to extract this from metadata later
            album: 'Unknown Album'   // You might want to extract this from metadata later
        });
    }    renderPlaylist();
}

audioPlayer.addEventListener('ended', () => {
    playNext();
});

function playNext() {
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= playlist.length) {
        nextIndex = 0;
    }
    if (playlist.length > 0) playTrack(nextIndex);
}

function playPrevious() {
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) {
        prevIndex = playlist.length - 1;
    }
    if (playlist.length > 0) playTrack(prevIndex);
}

// Initial render (empty)
renderPlaylist();

// Media Session API
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { audioPlayer.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { audioPlayer.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { playPrevious(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { playNext(); });

    // Optional: Set default playback state
    navigator.mediaSession.playbackState = 'paused';
}
