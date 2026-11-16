package com.apollo.choir;

import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "apollo_prefs";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String DEFAULT_SERVER_URL = "https://apollo.metaspexet.se";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApolloMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String customUrl = prefs.getString(PREF_SERVER_URL, null);
            if (customUrl != null && !customUrl.trim().isEmpty() && !customUrl.equals(DEFAULT_SERVER_URL)) {
                webView.loadUrl(customUrl.trim());
            }

            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                    intent.setData(Uri.parse(url));
                    intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    android.util.Log.e("Apollo", "Download intent failed", e);
                }
            });

            webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request != null && request.getUrl() != null) {
                        Uri url = request.getUrl();
                        String scheme = url.getScheme();
                        String path = url.getPath();

                        // Allow downloading .apk files directly via Android download/installer intent
                        if (path != null && path.endsWith(".apk")) {
                            try {
                                android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                                intent.setData(url);
                                intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                return true;
                            } catch (Exception ignored) {}
                        }

                        // Keep all web navigation (including OIDC SSO redirects) inside the Apollo app!
                        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                            return false; // Load inside this WebView, never launch external Chrome
                        }
                        return bridge.launchIntent(url);
                    }
                    return false;
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    // Automatically accept self-signed LAN / dev certificate
                    handler.proceed();
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (request != null && request.isForMainFrame()) {
                        runOnUiThread(() -> showServerConfigDialog("Could not connect to Apollo server. Please verify your server IP and network connection."));
                    }
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (this.bridge != null && this.bridge.getWebView() != null && this.bridge.getWebView().canGoBack()) {
            this.bridge.getWebView().goBack();
        } else {
            super.onBackPressed();
        }
    }

    public void showServerConfigDialog(String message) {
        if (isFinishing()) return;
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String currentUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL);

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Apollo Server Connection");
        builder.setMessage(message);

        final EditText input = new EditText(this);
        input.setText(currentUrl);
        input.setSelection(currentUrl.length());
        builder.setView(input);

        builder.setPositiveButton("Connect", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                prefs.edit().putString(PREF_SERVER_URL, newUrl).apply();
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().loadUrl(newUrl);
                }
            }
        });

        builder.setNegativeButton("Reset to Default", (dialog, which) -> {
            prefs.edit().putString(PREF_SERVER_URL, DEFAULT_SERVER_URL).apply();
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().loadUrl(DEFAULT_SERVER_URL);
            }
        });

        builder.setCancelable(true);
        builder.show();
    }
}
