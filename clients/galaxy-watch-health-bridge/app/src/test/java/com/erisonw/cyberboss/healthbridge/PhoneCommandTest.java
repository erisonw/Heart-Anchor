package com.erisonw.cyberboss.healthbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import java.util.List;
import org.junit.Test;

public class PhoneCommandTest {
    @Test
    public void parsesPhoneCommandPollResponse() {
        String json = "{"
                + "\"ok\":true,"
                + "\"deviceId\":\"phone-main\","
                + "\"commands\":["
                + "{"
                + "\"commandId\":\"cmd-alarm\","
                + "\"deviceId\":\"phone-main\","
                + "\"type\":\"set_alarm\","
                + "\"status\":\"queued\","
                + "\"payload\":{\"hour\":7,\"minute\":30,\"label\":\"Wake up\",\"skipUi\":true}"
                + "}"
                + "]"
                + "}";

        List<PhoneCommand> commands = PhoneCommandParser.INSTANCE.parsePollResponse(json);

        assertEquals(1, commands.size());
        assertEquals("cmd-alarm", commands.get(0).getCommandId());
        assertEquals("set_alarm", commands.get(0).getType());
        assertEquals(Integer.valueOf(7), commands.get(0).getPayload().getHour());
    }

    @Test
    public void buildsAlarmClockIntentSpecsForAlarmAndTimer() {
        PhoneCommand alarm = new PhoneCommand(
                "cmd-alarm",
                "phone-main",
                "set_alarm",
                "queued",
                new PhoneCommandPayload(7, 30, null, "Wake up", true, null, null),
                "2026-07-03T09:00:00Z");
        PhoneCommand timer = new PhoneCommand(
                "cmd-timer",
                "phone-main",
                "set_timer",
                "queued",
                new PhoneCommandPayload(null, null, 600, "Tea", false, null, null),
                "2026-07-03T09:00:00Z");

        PhoneCommandIntentSpec alarmSpec = PhoneCommandIntentFactory.INSTANCE.build(alarm);
        PhoneCommandIntentSpec timerSpec = PhoneCommandIntentFactory.INSTANCE.build(timer);

        assertEquals("android.intent.action.SET_ALARM", alarmSpec.getAction());
        assertEquals(7, alarmSpec.getExtras().get("android.intent.extra.alarm.HOUR"));
        assertEquals(30, alarmSpec.getExtras().get("android.intent.extra.alarm.MINUTES"));
        assertEquals("Wake up", alarmSpec.getExtras().get("android.intent.extra.alarm.MESSAGE"));
        assertEquals(true, alarmSpec.getExtras().get("android.intent.extra.alarm.SKIP_UI"));
        assertFalse(alarmSpec.getExtras().containsKey("android.intent.extra.alarm.LENGTH"));

        assertEquals("android.intent.action.SET_TIMER", timerSpec.getAction());
        assertEquals(600, timerSpec.getExtras().get("android.intent.extra.alarm.LENGTH"));
        assertEquals("Tea", timerSpec.getExtras().get("android.intent.extra.alarm.MESSAGE"));
        assertEquals(false, timerSpec.getExtras().get("android.intent.extra.alarm.SKIP_UI"));
    }
}
