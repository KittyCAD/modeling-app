#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::format::render_packet::RenderPacket;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketEdge;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketPrimitive;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketRegion;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketRegionLoop;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketSketchSegment;
    use kittycad_modeling_cmds::format::render_packet::RenderPacketTrimLoop;
    use ts_rs::Config;
    use ts_rs::TS;

    use crate::front::FrontendRenderPacket;
    use crate::front::FrontendRenderPacketSketchSegment;

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
