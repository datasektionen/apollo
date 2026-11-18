package com.apollo.choir;

import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "Apollo";
    public static final String PROD_SERVER_URL = "https://apollo.metaspexet.se";
    public static final String DEV_SERVER_URL = "https://192.168.1.218:3000";
    public static final String DEFAULT_SERVER_URL = BuildConfig.DEBUG ? DEV_SERVER_URL : PROD_SERVER_URL;

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

            String currentUrl = webView.getUrl();
            if (DEFAULT_SERVER_URL != null && !DEFAULT_SERVER_URL.trim().isEmpty()) {
                if (currentUrl == null || !currentUrl.startsWith(DEFAULT_SERVER_URL.trim())) {
                    webView.loadUrl(DEFAULT_SERVER_URL.trim());
                }
            }

            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                    intent.setData(Uri.parse(url));
                    intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Download intent failed", e);
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
                        String failingUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                        // If dev server on local network is unreachable, automatically fallback to production
                        if (failingUrl.startsWith(DEV_SERVER_URL) && !failingUrl.startsWith(PROD_SERVER_URL)) {
                            Log.w(TAG, "Dev server unreachable, auto-routing to production: " + PROD_SERVER_URL);
                            runOnUiThread(() -> view.loadUrl(PROD_SERVER_URL));
                        }
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
}
