package com.speaki.shogi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;

/**
 * Runs a USI shogi engine as a native child process and relays its stdout back
 * to the WebView.
 *
 * Android 10+ forbids executing files from the app's data directory, so the
 * engine binary ships inside jniLibs as "libyaneuraou.so" — files in
 * nativeLibraryDir keep their exec permission.
 */
@CapacitorPlugin(name = "ShogiEngine")
public class ShogiEnginePlugin extends Plugin {

    private static final String BINARY = "libyaneuraou.so";
    // The 184MB NNUE weights also ride along in jniLibs ("libnn.so"), so the
    // installer extracts them once to nativeLibraryDir — no runtime copy and no
    // second 184MB sitting in the app's data dir. Pointed at via EvalDir/EvalFile.
    private static final String EVAL_NAME = "libnn.so";

    private Process process;
    private BufferedWriter stdin;
    private Thread stdoutThread;
    private Thread stderrThread;

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (process != null) {
            call.resolve(new JSObject().put("started", true).put("already", true));
            return;
        }
        String nativeDir = getContext().getApplicationInfo().nativeLibraryDir;
        File exe = new File(nativeDir, BINARY);
        if (!exe.exists()) {
            call.reject("engine binary not found: " + exe.getAbsolutePath());
            return;
        }
        try {
            // Working dir = app files dir, so the engine can find eval/book files
            // that we copy there from assets.
            File workDir = getContext().getFilesDir();
            ProcessBuilder pb = new ProcessBuilder(exe.getAbsolutePath());
            pb.directory(workDir);
            process = pb.start();
            stdin = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));

            stdoutThread = new Thread(() -> pump(process.getInputStream(), "line"));
            stdoutThread.setDaemon(true);
            stdoutThread.start();

            stderrThread = new Thread(() -> pump(process.getErrorStream(), "stderr"));
            stderrThread.setDaemon(true);
            stderrThread.start();

            // If the engine dies (bad eval file, OOM kill, ...) say so straight
            // away instead of leaving the UI waiting for readyok.
            final Process watched = process;
            Thread exitWatcher = new Thread(() -> {
                try {
                    int code = watched.waitFor();
                    synchronized (ShogiEnginePlugin.this) {
                        if (process == watched) {
                            process = null;
                            stdin = null;
                        }
                    }
                    JSObject data = new JSObject();
                    data.put("code", code);
                    notifyListeners("exit", data);
                } catch (InterruptedException ignored) {
                }
            });
            exitWatcher.setDaemon(true);
            exitWatcher.start();

            File eval = new File(nativeDir, EVAL_NAME);
            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("path", exe.getAbsolutePath());
            ret.put("workDir", workDir.getAbsolutePath());
            // JS sends these as USI setoption values before "isready".
            ret.put("evalDir", nativeDir);
            ret.put("evalFile", EVAL_NAME);
            ret.put("evalExists", eval.exists());
            ret.put("evalSize", eval.exists() ? eval.length() : 0);
            call.resolve(ret);
        } catch (IOException e) {
            process = null;
            call.reject("failed to start engine: " + e.getMessage());
        }
    }

    private void pump(java.io.InputStream in, String event) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in))) {
            String line;
            while ((line = reader.readLine()) != null) {
                JSObject data = new JSObject();
                data.put("line", line);
                notifyListeners(event, data);
            }
        } catch (IOException ignored) {
            // process ended
        }
    }

    @PluginMethod
    public synchronized void send(PluginCall call) {
        String command = call.getString("command");
        if (command == null) {
            call.reject("command required");
            return;
        }
        if (stdin == null) {
            call.reject("engine not started");
            return;
        }
        try {
            stdin.write(command);
            stdin.write("\n");
            stdin.flush();
            call.resolve();
        } catch (IOException e) {
            call.reject("write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        shutdown();
        call.resolve();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        File exe = new File(getContext().getApplicationInfo().nativeLibraryDir, BINARY);
        call.resolve(new JSObject().put("available", exe.exists()));
    }

    private synchronized void shutdown() {
        try {
            if (stdin != null) {
                stdin.write("quit\n");
                stdin.flush();
                stdin.close();
            }
        } catch (IOException ignored) {
        }
        if (process != null) {
            process.destroy();
            process = null;
        }
        stdin = null;
    }

    @Override
    protected void handleOnDestroy() {
        shutdown();
    }
}
