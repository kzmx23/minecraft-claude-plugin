package com.egor.claudechat;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class ClaudeChatPlugin extends JavaPlugin {

    private String mcpServerUrl;
    private int timeoutMs;
    private int rateLimitCount;
    private int rateLimitPeriodMs;
    private final Map<UUID, LinkedList<Long>> rateLimitMap = new HashMap<>();
    private final Set<String> allowedPlayers = new HashSet<>();
    private HttpClient httpClient;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        mcpServerUrl = getConfig().getString("mcp-server-url", "http://172.16.1.1:25589");
        timeoutMs = getConfig().getInt("timeout-ms", 3000);
        rateLimitCount = getConfig().getInt("rate-limit-count", 3);
        rateLimitPeriodMs = getConfig().getInt("rate-limit-period", 30) * 1000;
        List<String> allowed = getConfig().getStringList("allowed-players");
        allowedPlayers.clear();
        for (String name : allowed) {
            allowedPlayers.add(name.toLowerCase());
        }
        httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .build();
        getLogger().info("ClaudeChat enabled! MCP server: " + mcpServerUrl
                + ", allowed: " + (allowedPlayers.isEmpty() ? "everyone" : allowedPlayers));
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("claude")) {
            return false;
        }

        if (!(sender instanceof Player player)) {
            sender.sendMessage("This command can only be used by players.");
            return true;
        }

        // Allowlist check
        if (!allowedPlayers.isEmpty()
                && !allowedPlayers.contains(player.getName().toLowerCase())) {
            player.sendMessage(Component.text("У тебя нет доступа к этой команде.")
                    .color(NamedTextColor.RED));
            return true;
        }

        if (args.length == 0) {
            player.sendMessage(Component.text("Использование: /claude <сообщение>")
                    .color(NamedTextColor.YELLOW));
            return true;
        }

        // Rate limit check
        if (isRateLimited(player.getUniqueId())) {
            player.sendMessage(Component.text("Подожди немного перед следующим сообщением!")
                    .color(NamedTextColor.RED));
            return true;
        }

        String message = String.join(" ", args);
        player.sendMessage(Component.text("Отправлено Claude!")
                .color(NamedTextColor.GREEN));

        // Send async HTTP POST
        String playerName = player.getName();
        String playerUuid = player.getUniqueId().toString();

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                String json = String.format(
                        "{\"player\":\"%s\",\"uuid\":\"%s\",\"message\":\"%s\"}",
                        escapeJson(playerName),
                        escapeJson(playerUuid),
                        escapeJson(message)
                );

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(mcpServerUrl + "/message"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json))
                        .timeout(Duration.ofMillis(timeoutMs))
                        .build();

                HttpResponse<String> response = httpClient.send(request,
                        HttpResponse.BodyHandlers.ofString());

                if (response.statusCode() != 200) {
                    sendError(player, "Ошибка сервера: " + response.statusCode());
                }
            } catch (Exception e) {
                getLogger().warning("Failed to send to MCP server: " + e.getMessage());
                sendError(player, "Claude сейчас не в сети. Попробуй позже!");
            }
        });

        return true;
    }

    private boolean isRateLimited(UUID playerId) {
        long now = System.currentTimeMillis();
        LinkedList<Long> timestamps = rateLimitMap.computeIfAbsent(playerId, k -> new LinkedList<>());

        // Remove expired entries
        while (!timestamps.isEmpty() && now - timestamps.peek() > rateLimitPeriodMs) {
            timestamps.poll();
        }

        if (timestamps.size() >= rateLimitCount) {
            return true;
        }

        timestamps.add(now);
        return false;
    }

    private void sendError(Player player, String message) {
        if (player.isOnline()) {
            getServer().getScheduler().runTask(this, () ->
                    player.sendMessage(Component.text(message).color(NamedTextColor.RED)));
        }
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
