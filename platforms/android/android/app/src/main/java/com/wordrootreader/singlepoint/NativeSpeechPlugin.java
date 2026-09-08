package com.wordrootreader.singlepoint;

import android.os.Bundle;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "NativeSpeech")
public class NativeSpeechPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private TextToSpeech engine;
    private volatile boolean ready = false;
    private volatile int activeSession = 0;

    @Override
    public void load() {
        engine = new TextToSpeech(getContext(), this);
        super.load();
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        if (ready) {
            engine.setLanguage(Locale.US);
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    int[] info = parseUtteranceId(utteranceId);
                    if (info == null || info[0] != activeSession) return;
                    JSObject data = new JSObject();
                    data.put("index", info[1]);
                    notifyListeners("sentenceStart", data);
                }

                @Override
                public void onDone(String utteranceId) {
                    int[] info = parseUtteranceId(utteranceId);
                    if (info == null || info[0] != activeSession || info[1] != info[2] - 1) return;
                    notifyListeners("speechDone", new JSObject());
                }

                @Override
                public void onError(String utteranceId) {
                    int[] info = parseUtteranceId(utteranceId);
                    if (info == null || info[0] != activeSession) return;
                    JSObject data = new JSObject();
                    data.put("message", "设备语音引擎朗读失败。");
                    notifyListeners("speechError", data);
                }
            });
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("没有可以朗读的文字。");
            return;
        }
        if (!ready || engine == null) {
            call.reject("设备语音引擎仍在初始化，请稍后再点一次。");
            return;
        }

        String language = call.getString("language", "en-US");
        double requestedRate = call.getDouble("rate", 0.9);
        float rate = (float) Math.max(0.55, Math.min(1.25, requestedRate));
        engine.stop();
        engine.setLanguage(Locale.forLanguageTag(language));
        engine.setSpeechRate(rate);

        int session = ++activeSession;
        List<String> chunks = new ArrayList<>();
        if (text.contains("\u241e")) {
            for (String chunk : text.split("\u241e")) if (!chunk.trim().isEmpty()) chunks.add(chunk.trim());
        } else {
            chunks = splitForSpeech(text, 3200);
        }
        for (int index = 0; index < chunks.size(); index++) {
            int queue = index == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            Bundle params = new Bundle();
            engine.speak(chunks.get(index), queue, params, "single-point-" + session + "-" + index + "-" + chunks.size());
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        activeSession++;
        if (engine != null) engine.stop();
        call.resolve();
    }

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty() || text.length() > 20 * 1024 * 1024) {
            call.reject("备份为空或超过 20 MB。");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "单点穿透-学习备份.json");
        startActivityForResult(call, intent, "backupSaved");
    }

    @ActivityCallback
    private void backupSaved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("你取消了保存。");
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (stream == null) throw new IllegalStateException("无法打开保存位置");
            stream.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception error) {
            call.reject("保存失败：" + error.getMessage());
        }
    }

    private int[] parseUtteranceId(String utteranceId) {
        if (utteranceId == null || !utteranceId.startsWith("single-point-")) return null;
        String[] parts = utteranceId.split("-");
        if (parts.length != 5) return null;
        try {
            return new int[]{Integer.parseInt(parts[2]), Integer.parseInt(parts[3]), Integer.parseInt(parts[4])};
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private List<String> splitForSpeech(String text, int maxLength) {
        List<String> chunks = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            int end = Math.min(text.length(), start + maxLength);
            if (end < text.length()) {
                int boundary = Math.max(text.lastIndexOf('.', end), Math.max(text.lastIndexOf('?', end), text.lastIndexOf('!', end)));
                if (boundary > start + maxLength / 2) end = boundary + 1;
            }
            chunks.add(text.substring(start, end).trim());
            start = end;
        }
        return chunks;
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) {
            engine.stop();
            engine.shutdown();
        }
        super.handleOnDestroy();
    }
}
