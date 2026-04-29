#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::format::render_packet::{
        RenderPacket, RenderPacketEdge, RenderPacketPrimitive, RenderPacketSketchSegment,
        RenderPacketTrimLoop,
    };
    use ts_rs::{Config, TS};

    #[test]
    fn export_bindings_renderpacket() {
        let cfg = Config::from_env();
        RenderPacket::export_all(&cfg).unwrap();
        RenderPacketEdge::export_all(&cfg).unwrap();
        RenderPacketPrimitive::export_all(&cfg).unwrap();
        RenderPacketSketchSegment::export_all(&cfg).unwrap();
        RenderPacketTrimLoop::export_all(&cfg).unwrap();
    }
}
