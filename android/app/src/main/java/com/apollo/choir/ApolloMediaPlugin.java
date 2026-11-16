package com.apollo.choir;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
        name = "ApolloMedia",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class ApolloMediaPlugin extends Plugin {
    private static final String TAG = "ApolloMediaPlugin";

    @Override
    public void load() {
        super.load();

        ApolloMediaService.setEventListener(new ApolloMediaService.MediaEventListener() {
            @Override
            public void onPlay() {
                JSObject data = new JSObject();
                data.put("action", "play");
                notifyListeners("mediaAction", data);
            }

            @Override
            public void onPause() {
                JSObject data = new JSObject();
                data.put("action", "pause");
                notifyListeners("mediaAction", data);
            }

            @Override
            public void onSkipToNext() {
                JSObject data = new JSObject();
                data.put("action", "next");
                notifyListeners("mediaAction", data);
            }

            @Override
            public void onSkipToPrevious() {
                JSObject data = new JSObject();
                data.put("action", "previous");
                notifyListeners("mediaAction", data);
            }

            @Override
            public void onSeekTo(long positionMs) {
                JSObject data = new JSObject();
                data.put("action", "seek");
                data.put("position", (double) positionMs / 1000.0);
                notifyListeners("mediaAction", data);
            }
        });
    }

    private void ensureServiceRunning(String title, String artist, String album, long durationMs, long positionMs, boolean isPlaying, String artworkUrl) {
        Context context = getContext();
        if (context == null) return;

        ApolloMediaService service = ApolloMediaService.getInstance();
        if (service != null) {
            service.updateMetadata(title, artist, album, durationMs, artworkUrl);
            service.updatePlaybackState(isPlaying, positionMs);
        } else {
            Intent intent = new Intent(context, ApolloMediaService.class);
            intent.setAction(ApolloMediaService.ACTION_INIT);
            intent.putExtra(ApolloMediaService.EXTRA_TITLE, title);
            intent.putExtra(ApolloMediaService.EXTRA_ARTIST, artist);
            intent.putExtra(ApolloMediaService.EXTRA_ALBUM, album);
            intent.putExtra(ApolloMediaService.EXTRA_DURATION, durationMs);
            intent.putExtra(ApolloMediaService.EXTRA_POSITION, positionMs);
            intent.putExtra(ApolloMediaService.EXTRA_IS_PLAYING, isPlaying);
            intent.putExtra(ApolloMediaService.EXTRA_ARTWORK_URL, artworkUrl);

            try {
                ContextCompat.startForegroundService(context, intent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start ApolloMediaService: " + e.getMessage());
            }
        }
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        String title = call.getString("title", "Apollo");
        String artist = call.getString("artist", "Apollo Choir");
        String album = call.getString("album", "");
        Double durationSec = call.getDouble("duration", 0.0);
        long durationMs = (durationSec != null) ? (long) (durationSec * 1000) : 0;
        String artworkUrl = call.getString("artworkUrl", "");

        ApolloMediaService service = ApolloMediaService.getInstance();
        if (service != null) {
            service.updateMetadata(title, artist, album, durationMs, artworkUrl);
        } else {
            ensureServiceRunning(title, artist, album, durationMs, 0, false, artworkUrl);
        }

        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        String state = call.getString("state", "paused");
        boolean isPlaying = "playing".equalsIgnoreCase(state);
        Double positionSec = call.getDouble("position", 0.0);
        long positionMs = (positionSec != null) ? (long) (positionSec * 1000) : 0;

        ApolloMediaService service = ApolloMediaService.getInstance();
        if (service != null) {
            service.updatePlaybackState(isPlaying, positionMs);
        } else {
            ensureServiceRunning("Apollo", "Apollo Choir", "", 0, positionMs, isPlaying, "");
        }

        call.resolve();
    }
}
