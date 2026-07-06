#[cfg(test)]
mod tests {
    use crate::front::{FrontendRenderPacket, FrontendRenderPacketSketchSegment};
    use kittycad_modeling_cmds::format::render_packet::{
        RenderPacket, RenderPacketEdge, RenderPacketPrimitive, RenderPacketRegion,
        RenderPacketRegionLoop, RenderPacketSketchSegment, RenderPacketTrimLoop,
    };
    use ts_rs::{Config, TS};

    #[test]
    fn export_bindings_renderpacket() {
        let cfg = Config::from_env();
        RenderPacket::export_all(&cfg).unwrap();
        RenderPacketEdge::export_all(&cfg).unwrap();
        RenderPacketPrimitive::export_all(&cfg).unwrap();
        RenderPacketRegion::export_all(&cfg).unwrap();
        RenderPacketRegionLoop::export_all(&cfg).unwrap();
        RenderPacketSketchSegment::export_all(&cfg).unwrap();
        RenderPacketTrimLoop::export_all(&cfg).unwrap();
        FrontendRenderPacket::export_all(&cfg).unwrap();
        FrontendRenderPacketSketchSegment::export_all(&cfg).unwrap();
    }
}
