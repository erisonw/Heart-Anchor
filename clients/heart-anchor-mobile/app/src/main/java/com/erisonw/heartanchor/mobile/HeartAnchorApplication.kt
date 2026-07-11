package com.erisonw.heartanchor.mobile

import android.app.Application
import com.erisonw.heartanchor.mobile.sync.SyncScheduler

class HeartAnchorApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SyncScheduler.schedule(this, immediate = false)
    }
}
