package com.purplecallio.android

import com.purplecallio.android.internal.net.Endpoints
import org.junit.Assert.assertEquals
import org.junit.Test

class EndpointsTest {
    @Test fun socketConnectsToTheHostWithoutApi() {
        assertEquals("https://calls.example.com", Endpoints.signalingUrl("https://calls.example.com/api"))
        assertEquals("https://calls.example.com", Endpoints.signalingUrl("https://calls.example.com/api/"))
    }

    @Test fun baseWithoutApiIsUsedAsIs() {
        assertEquals("http://localhost:3005", Endpoints.signalingUrl("http://localhost:3005"))
    }
}
