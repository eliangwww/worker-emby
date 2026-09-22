export interface AdminConfig {
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    ImageProxy: string;
    DoubanProxy: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
    is_adult?: boolean; // 新增：是否为成人内容资源站
    /**
     * 主源标记。
     *
     * 只允许一个源为主源：封面、简介、搜索、选集、推荐列表
     * 优先由主源提供；其余源仅作为**播放源补充**（主源拿不到
     * 可播放地址时才回退）。
     *
     * 多个源同时标记时，取配置中靠前的那个。
     */
    is_primary?: boolean;
  }[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
