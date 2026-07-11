package com.erisonw.heartanchor.mobile.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "focus_policies", primaryKeys = {"policyId", "revision"})
public class FocusPolicyEntity {
    @NonNull public String policyId = "";
    public int revision;
    @NonNull public String deviceId = "";
    @NonNull public String title = "";
    @NonNull public String packageNamesJson = "[]";
    @NonNull public String daysOfWeekJson = "[1,2,3,4,5,6,7]";
    @NonNull public String startTime = "00:00";
    @NonNull public String endTime = "23:59";
    @NonNull public String timeZone = "Asia/Shanghai";
    public int dailyLimitMinutes;
    @NonNull public String enforcementMode = "remind";
    @NonNull public String warningThresholdsJson = "[]";
    public int temporaryUnlockMinutes = 5;
    public boolean enabled = true;
    @NonNull public String state = "pending_approval";
    @NonNull public String sourceCommandId = "";
    public long createdAtEpochMs;
    public long updatedAtEpochMs;
    public long temporaryUnlockUntilEpochMs;
}
