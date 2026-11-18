package com.apollo.choir;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import android.view.KeyEvent;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class ApolloMediaService extends Service {
    private static final String TAG = "ApolloMediaService";
    public static final String CHANNEL_ID = "apollo_media_channel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_INIT = "com.apollo.choir.ACTION_INIT";
    public static final String ACTION_PLAY = "com.apollo.choir.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.apollo.choir.ACTION_PAUSE";
    public static final String ACTION_PREV = "com.apollo.choir.ACTION_PREV";
    public static final String ACTION_NEXT = "com.apollo.choir.ACTION_NEXT";
    public static final String ACTION_SEEK = "com.apollo.choir.ACTION_SEEK";
    public static final String ACTION_DISMISS = "com.apollo.choir.ACTION_DISMISS";

    public static final long PAUSE_TIMEOUT_MS = 10 * 60 * 1000L; // 10 minutes, same as Spotify

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_ALBUM = "extra_album";
    public static final String EXTRA_DURATION = "extra_duration";
    public static final String EXTRA_POSITION = "extra_position";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";
    public static final String EXTRA_ARTWORK_URL = "extra_artwork_url";

    public interface MediaEventListener {
        void onPlay();
        void onPause();
        void onSkipToNext();
        void onSkipToPrevious();
        void onSeekTo(long positionMs);
    }

    private static MediaEventListener eventListener;
    private static ApolloMediaService instance;

    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private String currentTitle = "Apollo";
    private String currentArtist = "Apollo Choir";
    private String currentAlbum = "";
    private long currentDuration = 0;
    private long currentPosition = 0;
    private boolean isPlaying = false;
    private String currentArtworkUrl = "";
    private Bitmap currentArtworkBitmap = null;
    private Bitmap defaultArtworkBitmap = null;
    private long lastStateUpdateTime = 0;

    private final Handler pauseHandler = new Handler(Looper.getMainLooper());
    private final Runnable pauseDismissRunnable = new Runnable() {
        @Override
        public void run() {
            dismissNotificationAndStop();
        }
    };

    private void schedulePauseDismissTimer() {
        cancelPauseDismissTimer();
        pauseHandler.postDelayed(pauseDismissRunnable, PAUSE_TIMEOUT_MS);
    }

    private void cancelPauseDismissTimer() {
        pauseHandler.removeCallbacks(pauseDismissRunnable);
    }

    public void dismissNotificationAndStop() {
        cancelPauseDismissTimer();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error dismissing notification: " + e.getMessage());
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        releaseWakeLock();
        stopSelf();
    }

    public static void setEventListener(MediaEventListener listener) {
        eventListener = listener;
    }

    public static ApolloMediaService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        try {
            defaultArtworkBitmap = BitmapFactory.decodeResource(getResources(), R.drawable.apollo_artwork);
            currentArtworkBitmap = defaultArtworkBitmap;
        } catch (Exception e) {
            Log.w(TAG, "Could not load default apollo_artwork: " + e.getMessage());
        }

        createNotificationChannel();
        initMediaSession();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Apollo Music Player Notification");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "ApolloMediaSession");
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON, null, this, MediaButtonReceiver.class);
        PendingIntent mbrIntent = PendingIntent.getBroadcast(
                this, 0, mediaButtonIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        mediaSession.setMediaButtonReceiver(mbrIntent);

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                updatePlaybackState(true, currentPosition);
                if (eventListener != null) {
                    eventListener.onPlay();
                }
            }

            @Override
            public void onPause() {
                long now = SystemClock.elapsedRealtime();
                long elapsed = (isPlaying && lastStateUpdateTime > 0) ? (now - lastStateUpdateTime) : 0;
                long actualPos = Math.max(0, currentPosition + elapsed);
                if (currentDuration > 0 && actualPos > currentDuration) {
                    actualPos = currentDuration;
                }
                updatePlaybackState(false, actualPos);
                if (eventListener != null) {
                    eventListener.onPause();
                }
            }

            @Override
            public void onSkipToNext() {
                if (eventListener != null) {
                    eventListener.onSkipToNext();
                }
            }

            @Override
            public void onSkipToPrevious() {
                if (eventListener != null) {
                    eventListener.onSkipToPrevious();
                }
            }

            @Override
            public void onSeekTo(long pos) {
                updatePlaybackState(isPlaying, pos);
                if (eventListener != null) {
                    eventListener.onSeekTo(pos);
                }
            }

            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                if (mediaButtonEvent == null) return false;
                KeyEvent keyEvent = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (keyEvent != null) {
                    int action = keyEvent.getAction();
                    int keyCode = keyEvent.getKeyCode();
                    if (action == KeyEvent.ACTION_DOWN) {
                        if (keyEvent.getRepeatCount() == 0) {
                            switch (keyCode) {
                                case KeyEvent.KEYCODE_MEDIA_PLAY:
                                    onPlay();
                                    return true;
                                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                                    onPause();
                                    return true;
                                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                                case KeyEvent.KEYCODE_HEADSETHOOK:
                                    if (isPlaying) {
                                        onPause();
                                    } else {
                                        onPlay();
                                    }
                                    return true;
                                case KeyEvent.KEYCODE_MEDIA_NEXT:
                                    onSkipToNext();
                                    return true;
                                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                                    onSkipToPrevious();
                                    return true;
                            }
                        }
                        return true;
                    } else if (action == KeyEvent.ACTION_UP) {
                        switch (keyCode) {
                            case KeyEvent.KEYCODE_MEDIA_PLAY:
                            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                            case KeyEvent.KEYCODE_HEADSETHOOK:
                            case KeyEvent.KEYCODE_MEDIA_NEXT:
                            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                                return true; // Consume ACTION_UP so super does not re-dispatch!
                        }
                    }
                }
                return super.onMediaButtonEvent(mediaButtonEvent);
            }
        });

        mediaSession.setPlaybackToLocal(android.media.AudioManager.STREAM_MUSIC);
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(mediaSession, intent);

        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if (ACTION_DISMISS.equals(action)) {
                dismissNotificationAndStop();
                return START_NOT_STICKY;
            } else if (ACTION_PLAY.equals(action)) {
                if (mediaSession != null && mediaSession.getController() != null) {
                    mediaSession.getController().getTransportControls().play();
                } else {
                    if (eventListener != null) eventListener.onPlay();
                    updatePlaybackState(true, currentPosition);
                }
            } else if (ACTION_PAUSE.equals(action)) {
                if (mediaSession != null && mediaSession.getController() != null) {
                    mediaSession.getController().getTransportControls().pause();
                } else {
                    if (eventListener != null) eventListener.onPause();
                    long now = SystemClock.elapsedRealtime();
                    long elapsed = (isPlaying && lastStateUpdateTime > 0) ? (now - lastStateUpdateTime) : 0;
                    long actualPos = Math.max(0, currentPosition + elapsed);
                    if (currentDuration > 0 && actualPos > currentDuration) {
                        actualPos = currentDuration;
                    }
                    updatePlaybackState(false, actualPos);
                }
            } else if (ACTION_PREV.equals(action)) {
                if (mediaSession != null && mediaSession.getController() != null) {
                    mediaSession.getController().getTransportControls().skipToPrevious();
                } else {
                    if (eventListener != null) eventListener.onSkipToPrevious();
                }
            } else if (ACTION_NEXT.equals(action)) {
                if (mediaSession != null && mediaSession.getController() != null) {
                    mediaSession.getController().getTransportControls().skipToNext();
                } else {
                    if (eventListener != null) eventListener.onSkipToNext();
                }
            } else if (ACTION_INIT.equals(action)) {
                currentTitle = intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : currentTitle;
                currentArtist = intent.getStringExtra(EXTRA_ARTIST) != null ? intent.getStringExtra(EXTRA_ARTIST) : currentArtist;
                currentAlbum = intent.getStringExtra(EXTRA_ALBUM) != null ? intent.getStringExtra(EXTRA_ALBUM) : currentAlbum;
                currentDuration = intent.getLongExtra(EXTRA_DURATION, currentDuration);
                currentPosition = intent.getLongExtra(EXTRA_POSITION, currentPosition);
                isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, isPlaying);

                String artworkUrl = intent.getStringExtra(EXTRA_ARTWORK_URL);
                boolean isDefault = (artworkUrl == null || artworkUrl.trim().isEmpty() ||
                                     artworkUrl.contains("icon-512") || artworkUrl.contains("icon-192"));
                if (isDefault) {
                    currentArtworkUrl = "";
                    currentArtworkBitmap = defaultArtworkBitmap;
                    updateSessionMetadata();
                    updatePlaybackState(isPlaying, currentPosition);
                    updateNotificationUI();
                } else if (!artworkUrl.equals(currentArtworkUrl)) {
                    currentArtworkUrl = artworkUrl;
                    updatePlaybackState(isPlaying, currentPosition);
                    loadArtworkAsync(artworkUrl);
                } else {
                    updateSessionMetadata();
                    updatePlaybackState(isPlaying, currentPosition);
                    updateNotificationUI();
                }
            }
        }

        return START_NOT_STICKY;
    }

    public void updateMetadata(String title, String artist, String album, long durationMs, String artworkUrl) {
        this.currentTitle = (title != null && !title.isEmpty()) ? title : "Apollo";
        this.currentArtist = (artist != null && !artist.isEmpty()) ? artist : "Apollo Choir";
        this.currentAlbum = album != null ? album : "";
        this.currentDuration = durationMs;

        boolean isDefault = (artworkUrl == null || artworkUrl.trim().isEmpty() ||
                             artworkUrl.contains("icon-512") || artworkUrl.contains("icon-192"));
        if (isDefault) {
            this.currentArtworkUrl = "";
            this.currentArtworkBitmap = defaultArtworkBitmap;
            updateSessionMetadata();
            updateNotificationUI();
        } else if (!artworkUrl.equals(currentArtworkUrl)) {
            this.currentArtworkUrl = artworkUrl;
            loadArtworkAsync(artworkUrl);
        } else {
            updateSessionMetadata();
            updateNotificationUI();
        }
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Apollo:PlaybackWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(60 * 60 * 1000L /* 1 hour */);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    public void updatePlaybackState(boolean playing, long positionMs) {
        boolean playStateChanged = (this.isPlaying != playing);
        this.isPlaying = playing;
        this.currentPosition = positionMs;
        this.lastStateUpdateTime = SystemClock.elapsedRealtime();

        if (playing) {
            cancelPauseDismissTimer();
            acquireWakeLock();
        } else {
            releaseWakeLock();
            schedulePauseDismissTimer();
        }

        long actions = PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_SEEK_TO;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                        playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        positionMs,
                        playing ? 1.0f : 0.0f,
                        SystemClock.elapsedRealtime()
                );

        if (mediaSession != null) {
            mediaSession.setPlaybackState(stateBuilder.build());
        }

        // Only re-post notification if playing state changed (toggles play/pause icon)
        // Never call setMetadata() or notify() on position updates during playback!
        if (playStateChanged) {
            updateNotificationUI();
        }
    }

    private void loadArtworkAsync(String urlString) {
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
                    URL url = new URL(urlString);
                    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                    if (connection instanceof HttpsURLConnection) {
                        HttpsURLConnection httpsConn = (HttpsURLConnection) connection;
                        TrustManager[] trustAll = new TrustManager[]{
                                new X509TrustManager() {
                                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                                    public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                                    public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                                }
                        };
                        SSLContext sc = SSLContext.getInstance("TLS");
                        sc.init(null, trustAll, new SecureRandom());
                        httpsConn.setSSLSocketFactory(sc.getSocketFactory());
                        httpsConn.setHostnameVerifier((hostname, session) -> true);
                    }
                    connection.setDoInput(true);
                    connection.setConnectTimeout(4000);
                    connection.setReadTimeout(4000);
                    connection.connect();
                    InputStream input = connection.getInputStream();
                    bitmap = BitmapFactory.decodeStream(input);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load artwork from " + urlString + ": " + e.getMessage());
            }
            currentArtworkBitmap = (bitmap != null) ? ensurePaddedArtworkBitmap(bitmap) : defaultArtworkBitmap;
            updateSessionMetadata();
            updateNotificationUI();
        });
    }

    private Bitmap ensurePaddedArtworkBitmap(Bitmap src) {
        if (src == null) return null;
        try {
            int w = src.getWidth();
            int h = src.getHeight();
            int targetDim = Math.max(Math.max(w, h), 512);
            Bitmap padded = Bitmap.createBitmap(targetDim, targetDim, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(padded);

            // Scale to ~89% of canvas for 'a few pixels margin' (~28px margin on 512x512)
            float margin = targetDim * (28f / 512f);
            float contentDim = targetDim - 2f * margin;
            float scale = Math.min(contentDim / w, contentDim / h);
            float destW = w * scale;
            float destH = h * scale;
            float left = targetDim - destW - margin;
            float top = margin;

            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(src, null, new RectF(left, top, left + destW, top + destH), paint);
            return padded;
        } catch (Exception e) {
            Log.w(TAG, "Failed to pad artwork bitmap: " + e.getMessage());
            return src;
        }
    }

    private void updateSessionMetadata() {
        if (mediaSession == null) return;

        Bitmap artwork = (currentArtworkBitmap != null) ? currentArtworkBitmap : defaultArtworkBitmap;

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration);

        if (artwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
        }

        mediaSession.setMetadata(metaBuilder.build());
    }

    private void updateNotificationUI() {
        if (mediaSession == null) return;

        Bitmap artwork = (currentArtworkBitmap != null) ? currentArtworkBitmap : defaultArtworkBitmap;

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration);

        if (artwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
        }

        mediaSession.setMetadata(metaBuilder.build());

        Notification notification = buildNotification();
        try {
            if (isPlaying) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
            } else {
                // Keep the service in foreground so the background process is not frozen by the OS while paused.
                // The 10-minute pause timer will call dismissNotificationAndStop() when it expires.
                if (notificationManager != null) {
                    notificationManager.notify(NOTIFICATION_ID, notification);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Notification error: " + e.getMessage());
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private Notification buildNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this, 0, contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent prevPendingIntent = PendingIntent.getService(
                this, 10, new Intent(this, ApolloMediaService.class).setAction(ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        int playPauseReqCode = isPlaying ? 20 : 21;
        PendingIntent playPausePendingIntent = PendingIntent.getService(
                this, playPauseReqCode, new Intent(this, ApolloMediaService.class).setAction(isPlaying ? ACTION_PAUSE : ACTION_PLAY),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent nextPendingIntent = PendingIntent.getService(
                this, 30, new Intent(this, ApolloMediaService.class).setAction(ACTION_NEXT),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent dismissPendingIntent = PendingIntent.getService(
                this, 40, new Intent(this, ApolloMediaService.class).setAction(ACTION_DISMISS),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        MediaStyle mediaStyle = new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);

        Bitmap artwork = (currentArtworkBitmap != null) ? currentArtworkBitmap : defaultArtworkBitmap;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setStyle(mediaStyle)
                .setSmallIcon(R.drawable.ic_notification_small)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum.isEmpty() ? null : currentAlbum)
                .setContentIntent(contentPendingIntent)
                .setDeleteIntent(dismissPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(0xFFA98C4D) // Apollo Gold
                .setColorized(true)
                .setOngoing(isPlaying)
                .addAction(R.drawable.ic_skip_previous, "Previous", prevPendingIntent)
                .addAction(isPlaying ? R.drawable.ic_pause : R.drawable.ic_play_arrow, isPlaying ? "Pause" : "Play", playPausePendingIntent)
                .addAction(R.drawable.ic_skip_next, "Next", nextPendingIntent);

        if (artwork != null) {
            builder.setLargeIcon(artwork);
        }

        return builder.build();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        cancelPauseDismissTimer();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        releaseWakeLock();
        instance = null;
        super.onDestroy();
    }
}
