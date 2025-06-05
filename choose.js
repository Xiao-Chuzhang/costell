//script.js

// Get DOM Elements
const songListContainer = document.getElementById('song-list');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const noResultsMessage = document.getElementById('no-results-message');
const randomPoolResetMessage = document.getElementById('random-pool-reset-message');

const selectedSongName = document.getElementById('selected-song-name');
const selectedSongArtist = document.getElementById('selected-song-artist');
const selectedSongLevel = document.getElementById('selected-song-level');
const startGameButton = document.getElementById('start-game-button');
const songPreviewAudio = document.getElementById('song-preview');

const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const clearSearchButton = document.getElementById('clear-search-button');
const randomSelectButton = document.getElementById('random-select-button');

// Global Data and State
let allSongsData = []; // Stores all loaded song data
let displayedSongs = []; // Songs currently shown in the list
let selectedSong = null; // The currently selected song object
let currentSelectedIndex = -1; // Index of the currently selected song in `displayedSongs`
let audioPlayTimeout; // Timeout ID for debouncing audio playback

const INITIAL_SONG_COUNT = 7; // Number of songs to display initially or upon random selection
let randomPoolIndices = []; // Stores indices of songs not yet randomly selected in current pool cycle

/**
 * Displays a specific message element and hides all other message elements.
 * @param {HTMLElement} element - The message element to show.
 * @returns {void}
 */
function showMessage(element) {
    [loadingMessage, errorMessage, noResultsMessage, randomPoolResetMessage].forEach(msg => {
        if (msg === element) {
            msg.classList.remove('hidden');
        } else {
            msg.classList.add('hidden');
        }
    });
}

/**
 * Hides all message elements.
 * @returns {void}
 */
function hideAllMessages() {
    [loadingMessage, errorMessage, noResultsMessage, randomPoolResetMessage].forEach(msg => {
        msg.classList.add('hidden');
    });
}

/**
 * Clears the search input field and hides the clear search button.
 * Ensures the search state is reset when not actively searching.
 * @returns {void}
 */
function clearSearchInputAndButton() {
    searchInput.value = '';
    clearSearchButton.classList.add('hidden');
}

/**
 * Asynchronously loads song data from 'list.json'.
 * Initializes the song list and default selection on success,
 * displays an error message on failure.
 * @returns {Promise<void>}
 */
async function loadSongs() {
    showMessage(loadingMessage);
    songListContainer.innerHTML = ''; // Clear previous list content
    startGameButton.disabled = true; 
    
    clearSearchInputAndButton();

    try {
        const response = await fetch('list.json');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        allSongsData = await response.json();
        if (allSongsData.length === 0) {
            throw new Error("歌曲列表为空。请在list.json文件中添加歌曲信息。");
        }
        
        hideAllMessages();
        songListContainer.classList.remove('hidden');

        resetRandomPool(); // Initialize random pool
        displayInitialSongs(); // Show initial songs

        randomSelectButton.disabled = false;
        searchButton.disabled = false;
        searchInput.disabled = false;
        
    } catch (error) {
        console.error('Fatal: Failed to load song list:', error); // Log detailed error for debugging
        showMessage(errorMessage);
        errorMessage.textContent = `加载歌曲列表失败: ${error.message} 请检查list.json文件。`;
        updateSongDetailsToDefault(); // Reset details and disable buttons
        randomSelectButton.disabled = true;
        searchButton.disabled = true;
        searchInput.disabled = true;
    }
}

/**
 * Displays the initial set of songs (first INITIAL_SONG_COUNT, or all if fewer).
 * @returns {void}
 */
function displayInitialSongs() {
    displayedSongs = allSongsData.slice(0, INITIAL_SONG_COUNT);
    populateSongList(displayedSongs);
    // When the page first loads and displays initial songs, selectSongByIndex(0) is called.
    // At this point, currentSelectedIndex is still -1, which serves as a flag for initial selection.
    selectSongByIndex(0); // Select the first song by default
    randomPoolResetMessage.classList.add('hidden'); 
}

/**
 * Dynamically populates the song list DOM with provided song data.
 * Handles empty results by showing appropriate messages.
 * @param {Array<Object>} songs - Array of song objects to display.
 * @returns {void}
 */
function populateSongList(songs) {
    songListContainer.innerHTML = '';

    if (songs.length === 0) {
        if (searchInput.value.trim() !== '') {
            showMessage(noResultsMessage);
            noResultsMessage.textContent = `无“${searchInput.value.trim()}”相关结果。`;
        } else {
            showMessage(errorMessage);
            errorMessage.textContent = "当前没有歌曲可供显示。请确保list.json中有足够的歌曲！";
        }
        updateSongDetailsToDefault();
        return;
    } else {
        hideAllMessages();
    }

    songs.forEach((song, index) => {
        const songItem = document.createElement('div');
        songItem.classList.add('song-item');
        songItem.dataset.index = index;

        songItem.innerHTML = `
            <img src="${song.cover || 'assets/covers/default.jpg'}" alt="${song.name}" class="song-cover" loading="lazy">
            <div class="song-info">
                <div class="song-title">${song.name}</div>
                <div class="song-artist">${song.artist || '未知'}</div>
                <div class="song-level">LEVEL：<span>${song.level}</span></div>
            </div>
        `;
        songListContainer.appendChild(songItem);
        songItem.addEventListener('click', () => selectSongByIndex(index));
    });
}

/**
 * Selects a song by its index in the currently displayed list.
 * Updates visual selection, song details, and starts preview audio.
 * @param {number} index - The index of the song to select.
 * @returns {void}
 */
function selectSongByIndex(index) {
    // Determine if this is the initial selection when the page first loads.
    // During initial load, currentSelectedIndex is -1, and index is 0.
    const isInitialSelection = (currentSelectedIndex === -1 && index === 0);

    // Prevent out-of-bounds selection or re-selecting the exact same song.
    // For initial load, this condition won't block it, as it's not "re-selecting the exact same song".
    if (index < 0 || index >= displayedSongs.length || (currentSelectedIndex === index && selectedSong === displayedSongs[index])) {
        // If it's not the initial selection and it's a re-selection of the same song, then return.
        if (!isInitialSelection) {
            return;
        }
    }

    // Remove 'selected' class from previously selected item
    const previousSelected = document.querySelector('.song-item.selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }

    // Add 'selected' class to new item and scroll into view
    const newSelectedItem = songListContainer.children[index];
    if (newSelectedItem) {
        newSelectedItem.classList.add('selected');
        newSelectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    selectedSong = displayedSongs[index]; // Update selected song object
    currentSelectedIndex = index; // Update selected index
    
    updateSongDetails(selectedSong); // Update right panel with new song details
    
    // Play new song preview, immediately if it's the initial selection.
    playSongPreviewDebounced(selectedSong.preview, isInitialSelection); 

    startGameButton.disabled = false;
    startGameButton.focus(); // Focus button for quick "Enter" press
}

/**
 * Updates the details panel with information from the provided song object.
 * @param {Object} song - The song object containing name, artist, and level.
 * @returns {void}
 */
function updateSongDetails(song) {
    selectedSongName.textContent = song.name;
    selectedSongArtist.textContent = song.artist || '未知';
    selectedSongLevel.textContent = song.level;

    // Apply glow/faint classes for visual style
    selectedSongName.classList.add('glow-text');
    selectedSongArtist.classList.remove('faint-text'); 
    selectedSongLevel.classList.add('glow-level-text');
}

/**
 * Resets the song details panel to its default "Please select a song" state.
 * Stops any playing preview audio.
 * @returns {void}
 */
function updateSongDetailsToDefault() {
    selectedSongName.textContent = '未选择';
    selectedSongArtist.textContent = '';
    selectedSongLevel.textContent = 'N/A';

    selectedSongName.classList.remove('glow-text');
    selectedSongArtist.classList.add('faint-text');
    selectedSongLevel.classList.remove('glow-level-text');

    startGameButton.disabled = true;
    if (audioPlayTimeout) clearTimeout(audioPlayTimeout);
    songPreviewAudio.pause();
    songPreviewAudio.removeAttribute('src'); // Remove source to stop loading audio data
    selectedSong = null;
    currentSelectedIndex = -1;
}

/**
 * Plays a song preview with debouncing to prevent rapid audio starts/stops.
 * @param {string} previewUrl - The URL of the audio preview.
 * @param {boolean} [isImmediate=false] - If true, attempts to play immediately without debounce.
 * @returns {void}
 */
function playSongPreviewDebounced(previewUrl, isImmediate = false) {
    if (audioPlayTimeout) {
        clearTimeout(audioPlayTimeout); // Clear any pending audio playback
    }
    songPreviewAudio.pause(); // Immediately stop current audio
    songPreviewAudio.removeAttribute('src'); // Clear audio source

    if (!previewUrl) { // Do not attempt to play if no preview URL is provided
        return;
    }

    const playAction = () => {
        songPreviewAudio.src = previewUrl;
        songPreviewAudio.currentTime = 0; // Start from beginning
        songPreviewAudio.volume = 0.8; // Set a default volume
        songPreviewAudio.play().catch(error => {
            // Common error: browser blocks autoplay until user interaction. Log as warning.
            console.warn('Audio auto-play prevented by browser (common due to no user interaction yet).', error);
        });
        audioPlayTimeout = null; // Clear timeout reference
    };

    if (isImmediate) {
        playAction(); // Execute play immediately
    } else {
        audioPlayTimeout = setTimeout(playAction, 250); // Debounce delay
    }
}

/**
 * Performs a search on `allSongsData` based on user input.
 * Filters by song name, artist, or level. Updates the displayed list.
 * @returns {void}
 */
function performSearch() {
    const query = searchInput.value.trim().toLowerCase();
    
    if (query === '') {
        clearSearch(); // If query is empty, treat as clear search
        return;
    }

    clearSearchButton.classList.remove('hidden'); // Show clear button

    // Filter songs based on name, artist, or numeric level match
    const filteredSongs = allSongsData.filter(song => {
        const nameMatch = song.name.toLowerCase().includes(query);
        const artistMatch = song.artist ? song.artist.toLowerCase().includes(query) : false;
        const levelQuery = parseInt(query);
        const levelMatch = !isNaN(levelQuery) && song.level === levelQuery;
        
        return nameMatch || artistMatch || levelMatch;
    });

    displayedSongs = filteredSongs;
    populateSongList(displayedSongs); // Re-populate list with search results
    selectSongByIndex(0); // Select the first item of search results

    if (displayedSongs.length === 0) {
        showMessage(noResultsMessage); // Show "no results" message
    } else {
        hideAllMessages(); // Hide messages if results found
    }
}

/**
 * Clears the current search query and resets the song list to its initial display.
 * @returns {void}
 */
function clearSearch() {
    searchInput.value = '';
    clearSearchButton.classList.add('hidden'); // Hide clear button
    hideAllMessages(); // Hide all messages
    displayInitialSongs(); // Revert to initial song display
}

/**
 * Resets the random song selection pool by including all song indices and shuffling them.
 * @returns {void}
 */
function resetRandomPool() {
    randomPoolIndices = Array.from({ length: allSongsData.length }, (_, i) => i);
    shuffleArray(randomPoolIndices);
}

/**
 * Selects a random set of `INITIAL_SONG_COUNT` songs from the available pool.
 * Resets the pool if it's exhausted to allow continuous random selection.
 * @returns {void}
 */
function selectRandomSongs() {
    if (allSongsData.length === 0) {
        showMessage(errorMessage);
        errorMessage.textContent = "没有可用的歌曲数据来执行随机选曲！";
        return;
    }
    
    clearSearchInputAndButton(); // Clear search state when randomizing

    hideAllMessages(); // Hide other messages

    const songsToPick = Math.min(INITIAL_SONG_COUNT, allSongsData.length);
    let pickedSongs = [];

    const poolResetNeeded = randomPoolIndices.length < songsToPick;
    if (poolResetNeeded) {
        resetRandomPool();
        // Display a brief message that the pool has been reset for the user
        showMessage(randomPoolResetMessage);
        setTimeout(() => randomPoolResetMessage.classList.add('hidden'), 3000); 
    }
    
    // Pick songs from the shuffled pool
    for (let i = 0; i < songsToPick; i++) {
        if (randomPoolIndices.length === 0) break; // Safety check in case pool becomes empty prematurely

        const randomIndexInPool = Math.floor(Math.random() * randomPoolIndices.length);
        const globalIndex = randomPoolIndices[randomIndexInPool];
        
        pickedSongs.push(allSongsData[globalIndex]);
        randomPoolIndices.splice(randomIndexInPool, 1); // Remove picked index from pool
    }
    
    displayedSongs = pickedSongs;
    populateSongList(displayedSongs);
    selectSongByIndex(0); // Select the first song in the new random list
}

/**
 * Shuffles an array in place using the Fisher-Yates (Knuth) algorithm.
 * @param {Array} array - The array to shuffle.
 * @returns {void}
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Initiates the game by navigating to the selected song's game path.
 * Ensures preview audio is stopped before navigation.
 * @returns {void}
 */
function startGame() {
    if (selectedSong && selectedSong.gamePath) {
        if (audioPlayTimeout) clearTimeout(audioPlayTimeout);
        songPreviewAudio.pause();
        songPreviewAudio.currentTime = 0; // Reset audio time
        window.location.href = selectedSong.gamePath; // Navigate to game
    } else {
        // User-friendly alert for game start failure
        console.error('Game launch attempt failed: No song selected or game path is missing.', selectedSong);
        alert('无法开始游戏：请选择一首歌曲或确认歌曲路径是否存在。');
    }
}

// --- Event Listeners ---
startGameButton.addEventListener('click', startGame);
searchButton.addEventListener('click', performSearch);
clearSearchButton.addEventListener('click', clearSearch);
randomSelectButton.addEventListener('click', selectRandomSongs);

// Search input keydown listener (for Enter key)
searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent default form submission behavior
        performSearch();
    }
});

// Search input `input` event listener (for dynamic clear button visibility)
searchInput.addEventListener('input', () => {
    if (searchInput.value.trim() !== '') {
        clearSearchButton.classList.remove('hidden');
    } else {
        clearSearchButton.classList.add('hidden');
        // Auto-reset list if currently in search results and search box is cleared
        const isCurrentlySearchResult = displayedSongs.length !== allSongsData.length || searchInput.value.trim() !== '';
        const isNotInitialDisplay = displayedSongs.length !== INITIAL_SONG_COUNT || 
                                    (allSongsData.length > INITIAL_SONG_COUNT && currentSelectedIndex >= INITIAL_SONG_COUNT);
        
        if (isCurrentlySearchResult && isNotInitialDisplay) {
            displayInitialSongs();
        } else if (!isCurrentlySearchResult && currentSelectedIndex === -1 && allSongsData.length > 0) {
            // Ensure first item is selected if the list is reset to default view and no song was selected
            selectSongByIndex(0);
        }
    }
});

// Global keyboard event listener for navigation and game start
document.addEventListener('keydown', (event) => {
    // Prevent default page scroll for arrow keys
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); 
    }

    if (displayedSongs.length === 0) return; // No songs to navigate

    if (event.key === 'ArrowDown') {
        const nextIndex = (currentSelectedIndex + 1) % displayedSongs.length;
        selectSongByIndex(nextIndex);
    } else if (event.key === 'ArrowUp') {
        const prevIndex = (currentSelectedIndex - 1 + displayedSongs.length) % displayedSongs.length;
        selectSongByIndex(prevIndex);
    } else if (event.key === 'Enter') {
        // If focus is on search input, trigger search; otherwise, attempt to start game
        if (document.activeElement === searchInput) {
            performSearch();
        } else if (selectedSong && !startGameButton.disabled) {
            startGame();
        }
    }
});


/**
 * Creates and displays a full-screen overlay, waiting for user interaction
 * to enable audio and start the application.
 * @returns {void}
 */
function createAndShowInitialClickOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'initial-click-overlay'; 
    // Applying styles directly via JS for a self-contained script
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.9); /* Dark semi-transparent background */
        z-index: 9999; /* Ensure it's on top */
        display: flex;
        justify-content: center;
        align-items: center;
        color: white;
        font-size: 2.5em;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* A common sans-serif font */
        cursor: pointer;
        text-align: center;
        transition: opacity 0.5s ease-out; /* Fade-out effect */
    `;

    overlay.innerHTML = `
        <div style="padding: 20px; border: 2px solid white; border-radius: 10px; box-shadow: 0 0 15px rgba(255,255,255,0.5);">
            <p style="margin: 0; padding-bottom: 10px;">※ COSTELL III ※</p>
            <p style="margin: 0; font-size: 0.6em; opacity: 0.8;">点击屏幕任意位置继续</p>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event listener for user interaction to remove the overlay and start the app
    overlay.addEventListener('click', () => {
        overlay.style.opacity = '0'; // Start fade-out
        setTimeout(() => {
            overlay.remove(); // Remove overlay after fade-out
            loadSongs(); // Now load songs and trigger initial audio playback
        }, 500); // Wait for the fade-out animation to complete
    }, { once: true }); // Ensure the event listener only triggers once
}


// Initialize application when DOM content is fully loaded.
// At this stage, only the initial click overlay is created and displayed.
// The actual song loading and primary application logic will start only after user interaction with the overlay.
document.addEventListener('DOMContentLoaded', createAndShowInitialClickOverlay);