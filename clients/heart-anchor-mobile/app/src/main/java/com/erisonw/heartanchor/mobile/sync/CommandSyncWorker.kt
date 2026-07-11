package com.erisonw.heartanchor.mobile.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.erisonw.heartanchor.mobile.MobileRepository

class CommandSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        MobileRepository.get(applicationContext).sync()
        Result.success()
    }.getOrElse { Result.retry() }
}
